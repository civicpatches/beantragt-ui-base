import type {
    BoundaryMultiPolygonCoordinates,
    BoundaryPolygonCoordinates,
    BoundaryPosition,
    BoundaryRing,
    JurisdictionBoundary,
    JurisdictionBoundaryFeature
} from '~/types/jurisdiction-boundary';

const MAX_FEATURES = 25;
const MAX_VERTICES = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function position(value: unknown): BoundaryPosition | null {
    if (!Array.isArray(value) || value.length < 2) return null;
    if (typeof value[0] !== 'number' || typeof value[1] !== 'number') return null;
    const lng = value[0];
    const lat = value[1];
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    return [lng, lat];
}

function ring(value: unknown, vertexCount: { value: number }): BoundaryRing | null {
    if (!Array.isArray(value) || value.length < 4) return null;
    const next = value.map(position);
    if (next.some(item => item === null)) return null;
    vertexCount.value += next.length;
    return vertexCount.value <= MAX_VERTICES ? next as BoundaryRing : null;
}

function polygon(value: unknown, vertexCount: { value: number }): BoundaryPolygonCoordinates | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const next = value.map(item => ring(item, vertexCount));
    return next.some(item => item === null) ? null : next as BoundaryPolygonCoordinates;
}

function multiPolygon(value: unknown, vertexCount: { value: number }): BoundaryMultiPolygonCoordinates | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const next = value.map(item => polygon(item, vertexCount));
    return next.some(item => item === null) ? null : next as BoundaryMultiPolygonCoordinates;
}

/**
 * Projects untrusted API or fallback JSON onto the supported boundary shape.
 */
export function normalizeJurisdictionBoundary(value: unknown): JurisdictionBoundary | null {
    if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) return null;
    if (value.features.length === 0 || value.features.length > MAX_FEATURES) return null;

    const vertexCount = { value: 0 };
    const features: JurisdictionBoundaryFeature[] = [];
    for (const item of value.features) {
        if (!isRecord(item) || item.type !== 'Feature' || !isRecord(item.geometry)) return null;
        const geometryType = item.geometry.type;
        const coordinates = geometryType === 'Polygon'
            ? polygon(item.geometry.coordinates, vertexCount)
            : geometryType === 'MultiPolygon'
                ? multiPolygon(item.geometry.coordinates, vertexCount)
                : null;
        if (!coordinates) return null;
        features.push({
            type: 'Feature',
            properties: isRecord(item.properties) ? item.properties : {},
            geometry: geometryType === 'Polygon'
                ? { type: 'Polygon', coordinates: coordinates as BoundaryPolygonCoordinates }
                : { type: 'MultiPolygon', coordinates: coordinates as BoundaryMultiPolygonCoordinates }
        });
    }

    return { type: 'FeatureCollection', features };
}

function pointInRing(point: BoundaryPosition, polygon: BoundaryRing): boolean {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const current = polygon[i];
        const previous = polygon[j];
        if (!current || !previous) continue;
        const [xi, yi] = current;
        const [xj, yj] = previous;
        const intersect = ((yi > y) !== (yj > y))
          && (x < ((xj - xi) * (y - yi) / (yj - yi)) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointInPolygon(point: BoundaryPosition, rings: BoundaryPolygonCoordinates): boolean {
    const exterior = rings[0];
    if (!exterior || !pointInRing(point, exterior)) return false;
    return !rings.slice(1).some(hole => pointInRing(point, hole));
}

/**
 * Checks all features as a union while respecting Polygon holes.
 */
export function isPointInJurisdictionBoundary(
    boundary: JurisdictionBoundary,
    lat: number,
    lng: number
): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const point: BoundaryPosition = [lng, lat];
    return boundary.features.some((feature) => {
        if (feature.geometry.type === 'Polygon') {
            return pointInPolygon(point, feature.geometry.coordinates);
        }
        return feature.geometry.coordinates.some(polygonCoordinates => pointInPolygon(point, polygonCoordinates));
    });
}

/**
 * Returns MapLibre bounds as southwest and northeast coordinate pairs.
 */
export function jurisdictionBoundaryBounds(
    boundary: JurisdictionBoundary
): [BoundaryPosition, BoundaryPosition] | null {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    const visit = ([lng, lat]: BoundaryPosition) => {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
    };
    for (const feature of boundary.features) {
        const polygons = feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
        for (const polygonCoordinates of polygons) {
            for (const boundaryRing of polygonCoordinates) {
                boundaryRing.forEach(visit);
            }
        }
    }
    return Number.isFinite(minLng)
        ? [[minLng, minLat], [maxLng, maxLat]]
        : null;
}
