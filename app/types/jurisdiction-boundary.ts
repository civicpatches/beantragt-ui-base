export type BoundaryPosition = [number, number];
export type BoundaryRing = BoundaryPosition[];
export type BoundaryPolygonCoordinates = BoundaryRing[];
export type BoundaryMultiPolygonCoordinates = BoundaryPolygonCoordinates[];

export interface BoundaryPolygonGeometry {
    type: 'Polygon'
    coordinates: BoundaryPolygonCoordinates
}

export interface BoundaryMultiPolygonGeometry {
    type: 'MultiPolygon'
    coordinates: BoundaryMultiPolygonCoordinates
}

export interface JurisdictionBoundaryFeature {
    type: 'Feature'
    properties: Record<string, unknown>
    geometry: BoundaryPolygonGeometry | BoundaryMultiPolygonGeometry
}

export interface JurisdictionBoundary {
    type: 'FeatureCollection'
    features: JurisdictionBoundaryFeature[]
}
