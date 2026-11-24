export function isRasterLogo(src: string | null | undefined): boolean {
    if (!src) return false;

    if (/^data:/i.test(src)) {
        return /^data:image\/(?:png|jpe?g|webp|gif)[;,]/i.test(src);
    }

    const path = src.split(/[?#]/, 1)[0] || '';
    return /\.(?:png|jpe?g|webp|gif)$/i.test(path);
}
