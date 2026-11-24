const SAFE_MARKER_COLOR = /^#[0-9a-f]{6}$/i;
let markerSequence = 0;

export function createLocationMarkerElement(color: string = '#ef4444'): HTMLElement {
    const markerColor = SAFE_MARKER_COLOR.test(color.trim()) ? color.trim() : '#ef4444';
    markerSequence += 1;
    const shadowId = `beantragt-marker-shadow-${markerSequence}`;
    const element = document.createElement('div');
    element.className = 'beantragt-location-marker';
    element.style.cssText = [
        'position:relative',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:40px',
        'height:61px',
        'cursor:move',
        'filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))',
        'touch-action:manipulation',
        '-webkit-touch-callout:none',
        '-webkit-user-select:none',
        '-webkit-tap-highlight-color:transparent'
    ].join(';');
    element.innerHTML = `
      <svg width="40" height="61" viewBox="0 -20 40 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="overflow:visible;pointer-events:none">
        <defs>
          <filter id="${shadowId}" x="-200%" y="-200%" width="400%" height="400%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
          </filter>
        </defs>
        <g transform="translate(20,56)" pointer-events="none">
          <ellipse cx="0" cy="0" rx="16" ry="5" fill="black" opacity=".3" filter="url(#${shadowId})" />
        </g>
        <g class="beantragt-location-marker-pulse" transform="translate(0,-19)">
          <path d="M20 4C11 4 4 11 4 20c0 12 16 32 16 32s16-20 16-32c0-9-7-16-16-16Z" fill="${markerColor}" />
          <circle cx="20" cy="20" r="11" fill="white" />
          <path d="M20 13v3M20 24v3M13 20h3M24 20h3" stroke="${markerColor}" stroke-width="3.5" stroke-linecap="round" />
          <path d="M20 11l2 2-2 2-2-2 2-2ZM13 18l2 2-2 2-2-2 2-2ZM27 18l2 2-2 2-2-2 2-2ZM20 25l2 2-2 2-2-2 2-2Z" fill="${markerColor}" />
        </g>
      </svg>`;
    element.addEventListener('contextmenu', event => event.preventDefault());
    return element;
}
