// =============================================================================
// PDF Thumbnail Generator
// Converts the first page of a PDF file into a static PNG image using the
// `pdftoppm` binary (poppler-utils, installed in the Docker image).
// Thumbnails are cached on disk next to the source file — generated once,
// then reused on every subsequent request.
// =============================================================================

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const BACKEND_ROOT = path.join(__dirname, '..');

/**
 * Convert a `/uploads/...` relative URL into an absolute filesystem path.
 */
function _resolveAbsolutePath(relativeUrl) {
    if (!relativeUrl) return null;
    const cleanPath = relativeUrl.split('?')[0].split('#')[0];
    if (!cleanPath.startsWith('/uploads/')) return null;
    return path.join(BACKEND_ROOT, cleanPath);
}

/**
 * Ensure a PNG thumbnail exists for the given PDF (relative `/uploads/...` URL).
 * Returns the relative `/uploads/...` URL of the generated thumbnail, or null
 * if generation failed (missing file, corrupt PDF, pdftoppm unavailable, etc).
 *
 * Thumbnails are cached as "<original-filename>.thumb.png" alongside the PDF.
 */
async function ensurePdfThumbnail(pdfRelativeUrl) {
    try {
        const ext = path.extname(pdfRelativeUrl.split('?')[0]).toLowerCase();
        if (ext !== '.pdf') return null;

        const absPdfPath = _resolveAbsolutePath(pdfRelativeUrl);
        if (!absPdfPath || !fs.existsSync(absPdfPath)) return null;

        const dir = path.dirname(absPdfPath);
        const base = path.basename(absPdfPath, '.pdf');
        const thumbAbsPath = path.join(dir, `${base}.thumb.png`);
        const thumbRelativeUrl = pdfRelativeUrl.replace(/\.pdf$/i, '.thumb.png');

        // Already generated — reuse cached thumbnail.
        if (fs.existsSync(thumbAbsPath) && fs.statSync(thumbAbsPath).size > 0) {
            return thumbRelativeUrl;
        }

        const outputPrefix = path.join(dir, base + '.thumb');
        await new Promise((resolve, reject) => {
            execFile(
                'pdftoppm',
                ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to', '900', absPdfPath, outputPrefix],
                { timeout: 20000 },
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });

        if (fs.existsSync(thumbAbsPath) && fs.statSync(thumbAbsPath).size > 0) {
            return thumbRelativeUrl;
        }
        return null;
    } catch (err) {
        console.error('[PdfThumbnail] generation failed for', pdfRelativeUrl, '-', err.message);
        return null;
    }
}

module.exports = { ensurePdfThumbnail };
