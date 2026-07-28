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
        if (ext !== '.pdf') {
            console.log('[PdfThumbnail] Not a PDF, skipping:', pdfRelativeUrl);
            return null;
        }

        const absPdfPath = _resolveAbsolutePath(pdfRelativeUrl);
        console.log('[PdfThumbnail] Resolved path:', absPdfPath, 'from URL:', pdfRelativeUrl);
        if (!absPdfPath || !fs.existsSync(absPdfPath)) {
            console.error('[PdfThumbnail] PDF file not found at:', absPdfPath);
            return null;
        }
        console.log('[PdfThumbnail] PDF file exists, size:', fs.statSync(absPdfPath).size);

        const dir = path.dirname(absPdfPath);
        const base = path.basename(absPdfPath, '.pdf');
        const thumbAbsPath = path.join(dir, `${base}.thumb.png`);
        const thumbRelativeUrl = pdfRelativeUrl.replace(/\.pdf$/i, '.thumb.png');

        // Already generated — reuse cached thumbnail.
        if (fs.existsSync(thumbAbsPath) && fs.statSync(thumbAbsPath).size > 0) {
            console.log('[PdfThumbnail] Cached thumbnail exists:', thumbAbsPath);
            return thumbRelativeUrl;
        }

        const outputPrefix = path.join(dir, base + '.thumb');
        console.log('[PdfThumbnail] Running pdftoppm:', absPdfPath, '→', outputPrefix);
        await new Promise((resolve, reject) => {
            execFile(
                'pdftoppm',
                ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to', '900', absPdfPath, outputPrefix],
                { timeout: 20000 },
                (err, stdout, stderr) => {
                    if (err) {
                        console.error('[PdfThumbnail] pdftoppm error:', err.message);
                        if (stderr) console.error('[PdfThumbnail] pdftoppm stderr:', stderr);
                        return reject(err);
                    }
                    console.log('[PdfThumbnail] pdftoppm success');
                    resolve();
                }
            );
        });

        if (fs.existsSync(thumbAbsPath) && fs.statSync(thumbAbsPath).size > 0) {
            console.log('[PdfThumbnail] Thumbnail generated:', thumbAbsPath, 'size:', fs.statSync(thumbAbsPath).size);
            return thumbRelativeUrl;
        }
        console.error('[PdfThumbnail] Thumbnail file not created:', thumbAbsPath);
        return null;
    } catch (err) {
        console.error('[PdfThumbnail] generation failed for', pdfRelativeUrl, '-', err.message);
        return null;
    }
}

module.exports = { ensurePdfThumbnail };
