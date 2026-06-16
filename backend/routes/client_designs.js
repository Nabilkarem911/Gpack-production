// =============================================================================
// Client Designs Routes
// Handles: upload, list, get designs for clients with file storage
// =============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorize');
const { success, error } = require('../utils/response');

// ============================================================================
// File Upload Configuration
// ============================================================================
const UPLOAD_BASE = path.join(__dirname, '../uploads/clients');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_BASE)) {
    fs.mkdirSync(UPLOAD_BASE, { recursive: true });
}

const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const { client_id, design_id } = req.body;
        if (!client_id || !validateUuid(client_id)) {
            return cb(new Error('client_id must be a valid UUID'), null);
        }
        
        const clientDir = path.join(UPLOAD_BASE, client_id);
        const designDir = path.join(clientDir, (design_id && validateUuid(design_id)) ? design_id : 'temp');
        
        fs.mkdirSync(designDir, { recursive: true });
        cb(null, designDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max for large design files
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|ai|psd|eps|svg|webp|tiff|tif|bmp|raw|heic/;
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.test(ext)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم. الأنواع المسموحة: JPG, PNG, GIF, PDF, AI, PSD, EPS, SVG, WEBP, TIFF, BMP, RAW, HEIC'));
        }
    }
});

// ============================================================================
// Helper: Generate next design number for client+variant
// ============================================================================
function validateUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function getNextDesignNumber(clientId, variantId) {
    const result = await db.query(
        `SELECT COALESCE(MAX(design_number), 0) + 1 as next_num 
         FROM client_designs 
         WHERE client_id = $1 AND variant_id = $2`,
        [clientId, variantId]
    );
    return result.rows[0].next_num;
}

// ============================================================================
// GET /api/client-designs?client_id=xxx&variant_id=yyy
// List designs by client_id (optional variant_id filter)
// ============================================================================
router.get('/', authenticate, authorize(['admin', 'manager', 'super_admin', 'sales_rep']), async (req, res) => {
    try {
        const { client_id, variant_id } = req.query;
        
        if (!client_id) {
            return error(res, 'client_id is required', 400);
        }

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                [client_id]
            );
            if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                return error(res, 'غير مصرح لك بعرض تصاميم هذا العميل.', 403);
            }
        }
        
        let query = `
            SELECT 
                cd.id,
                cd.client_id,
                cd.variant_id,
                cd.design_number,
                cd.design_name,
                cd.description,
                cd.is_active,
                cd.created_at,
                cdf.file_path as thumbnail_path,
                cdf.id as thumbnail_id
             FROM client_designs cd
             LEFT JOIN client_design_files cdf 
                ON cdf.design_id = cd.id AND cdf.file_type = 'thumbnail'
             WHERE cd.client_id = $1
        `;
        const params = [client_id];
        
        if (variant_id) {
            query += ` AND cd.variant_id = $2`;
            params.push(variant_id);
        }
        
        query += ` ORDER BY cd.design_number DESC`;
        
        const designsResult = await db.query(query, params);
        
        const designs = designsResult.rows.map(d => ({
            ...d,
            thumbnail_url: d.thumbnail_path || null
        }));
        
        return res.json({ 
            success: true, 
            data: designs,
            count: designs.length
        });
        
    } catch (err) {
        console.error('[ClientDesigns] List error:', err);
        return error(res, 'Internal server error.', 500);
    }
});

// ============================================================================
// GET /api/client-designs/:client_id/:variant_id
// List all designs for a specific client + variant
// Returns designs with thumbnail URLs
// ============================================================================
router.get('/:client_id/:variant_id', authenticate, authorize(['admin', 'manager', 'super_admin', 'sales_rep']), async (req, res) => {
    try {
        const { client_id, variant_id } = req.params;

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                [client_id]
            );
            if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                return error(res, 'غير مصرح لك بعرض تصاميم هذا العميل.', 403);
            }
        }
        
        const designsResult = await db.query(
            `SELECT 
                cd.id,
                cd.client_id,
                cd.variant_id,
                cd.design_number,
                cd.design_name,
                cd.description,
                cd.is_active,
                cd.created_at,
                cdf.file_path as thumbnail_path,
                cdf.id as thumbnail_id
             FROM client_designs cd
             LEFT JOIN client_design_files cdf 
                ON cdf.design_id = cd.id AND cdf.file_type = 'thumbnail'
             WHERE cd.client_id = $1 AND cd.variant_id = $2
             ORDER BY cd.design_number DESC`,
            [client_id, variant_id]
        );
        
        const designs = designsResult.rows.map(d => ({
            ...d,
            thumbnail_url: d.thumbnail_path || null
        }));
        
        return res.json({ 
            success: true, 
            data: designs,
            count: designs.length
        });
        
    } catch (err) {
        console.error('[ClientDesigns] List error:', err);
        return error(res, 'Internal server error.', 500);
    }
});

// ============================================================================
// POST /api/client-designs
// Create new design with optional file upload
// Body: client_id, variant_id, design_name, description, is_active
// Files: thumbnail (image), pdf, ai, psd (optional)
// ============================================================================
router.post('/', authenticate, authorize(['admin', 'manager', 'super_admin', 'sales_rep']), upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'pdf', maxCount: 1 },
    { name: 'ai', maxCount: 1 },
    { name: 'psd', maxCount: 1 },
    { name: 'source', maxCount: 5 }
]), async (req, res) => {
    try {
        const { client_id, variant_id, design_name, description } = req.body;
        
        if (!client_id || !variant_id) {
            return res.status(400).json({ success: false, error: 'client_id and variant_id required' });
        }
        
        // Get next design number
        const designNumber = await getNextDesignNumber(client_id, variant_id);
        
        // Create design record
        const designResult = await db.query(
            `INSERT INTO client_designs 
             (client_id, variant_id, design_number, design_name, description, is_active)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [client_id, variant_id, designNumber, design_name || `تصميم ${designNumber}`, description, true]
        );
        
        const design = designResult.rows[0];
        if (!validateUuid(client_id)) {
            return error(res, 'Invalid client_id', 400);
        }
        const designDir = path.join(UPLOAD_BASE, client_id, design.id);
        fs.mkdirSync(designDir, { recursive: true });
        
        // Move temp files to design directory if uploaded
        const files = req.files;
        const fileRecords = [];
        
        if (files) {
            for (const [fieldName, fileArray] of Object.entries(files)) {
                for (const file of fileArray) {
                    // Move from temp to design folder
                    const tempPath = file.path;
                    const finalPath = path.join(designDir, file.filename);
                    fs.renameSync(tempPath, finalPath);
                    
                    // Save to database
                    const fileType = fieldName === 'source' ? 
                        path.extname(file.originalname).slice(1) : fieldName;
                    
                    // Store as relative URL path for frontend access
                    const relativeUrl = `/uploads/clients/${client_id}/${design.id}/${file.filename}`;
                    
                    const fileResult = await db.query(
                        `INSERT INTO client_design_files 
                         (design_id, file_type, file_path, original_name, file_size, mime_type, uploaded_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         RETURNING *`,
                        [design.id, fileType, relativeUrl, file.originalname, file.size, file.mimetype, req.user.id]
                    );
                    fileRecords.push(fileResult.rows[0]);
                }
            }
        }
        
        return res.json({
            success: true,
            data: {
                ...design,
                files: fileRecords,
                thumbnail_url: fileRecords.find(f => f.file_type === 'thumbnail')?.file_path || null
            },
            message: 'تم إنشاء التصميم بنجاح'
        });
        
    } catch (err) {
        console.error('[ClientDesigns] Create error:', err);
        console.error('[ClientDesigns] Stack:', err.stack);
        console.error('[ClientDesigns] Request body:', req.body);
        console.error('[ClientDesigns] User:', req.user);
        return error(res, 'Internal server error.', 500);
    }
});

// ============================================================================
// GET /api/client-designs/by-id/:design_id
// Get single design details with all files
// ============================================================================
router.get('/by-id/:design_id', authenticate, authorize(['admin', 'manager', 'super_admin', 'sales_rep']), async (req, res) => {
    try {
        const { design_id } = req.params;
        
        const designResult = await db.query(
            `SELECT * FROM client_designs WHERE id = $1`,
            [design_id]
        );
        
        if (designResult.rowCount === 0) {
            return error(res, 'Design not found', 404);
        }

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                [designResult.rows[0].client_id]
            );
            if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                return error(res, 'غير مصرح لك بعرض هذا التصميم.', 403);
            }
        }
        
        const filesResult = await db.query(
            `SELECT * FROM client_design_files WHERE design_id = $1`,
            [design_id]
        );
        
        const design = designResult.rows[0];
        const files = filesResult.rows.map(f => ({
            ...f,
            download_url: `/api/client-designs/download/${f.id}`
        }));
        
        return success(res, { ...design, files });
        
    } catch (err) {
        console.error('[ClientDesigns] Get error:', err);
        return error(res, 'Internal server error.', 500);
    }
});

// ============================================================================
// GET /api/client-designs/download/:file_id
// Download a design file
// ============================================================================
router.get('/download/:file_id', authenticate, authorize(['admin', 'manager', 'super_admin', 'sales_rep']), async (req, res) => {
    try {
        const { file_id } = req.params;
        
        const fileResult = await db.query(
            `SELECT f.*, d.client_id FROM client_design_files f
             JOIN client_designs d ON d.id = f.design_id
             WHERE f.id = $1`,
            [file_id]
        );
        
        if (fileResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                [fileResult.rows[0].client_id]
            );
            if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                return res.status(403).json({ success: false, error: 'غير مصرح لك بتحميل هذا الملف.' });
            }
        }
        
        const file = fileResult.rows[0];
        
        if (!fs.existsSync(file.file_path)) {
            return res.status(404).json({ success: false, error: 'File not found on disk' });
        }
        
        res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        
        const fileStream = fs.createReadStream(file.file_path);
        fileStream.pipe(res);
        
    } catch (err) {
        console.error('[ClientDesigns] Download error:', err);
        return error(res, 'Internal server error.', 500);
    }
});

// ============================================================================
// DELETE /api/client-designs/:design_id
// Delete design and all its files
// ============================================================================
router.delete('/:design_id', authenticate, authorize(['admin', 'manager', 'super_admin', 'sales_rep']), async (req, res) => {
    try {
        const { design_id } = req.params;
        
        // Get design info first
        const designResult = await db.query(
            `SELECT * FROM client_designs WHERE id = $1`,
            [design_id]
        );
        
        if (designResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Design not found' });
        }

        // Ownership check for sales_rep
        const isSalesRep = req.user.role === 'sales_rep';
        if (isSalesRep) {
            const clientCheck = await db.query(
                'SELECT created_by FROM clients WHERE id = $1 LIMIT 1',
                [designResult.rows[0].client_id]
            );
            if (!clientCheck.rows.length || clientCheck.rows[0].created_by !== req.user.id) {
                return error(res, 'غير مصرح لك بحذف هذا التصميم.', 403);
            }
        }
        
        const design = designResult.rows[0];
        const designDir = path.join(UPLOAD_BASE, design.client_id, design.id);
        
        // Delete directory recursively
        if (fs.existsSync(designDir)) {
            fs.rmSync(designDir, { recursive: true, force: true });
        }
        
        // Delete from database (cascade will delete files)
        await db.query(`DELETE FROM client_designs WHERE id = $1`, [design_id]);
        
        return res.json({
            success: true,
            message: 'تم حذف التصميم بنجاح'
        });
        
    } catch (err) {
        console.error('[ClientDesigns] Delete error:', err);
        return error(res, 'Internal server error.', 500);
    }
});

// ============================================================================
// Error handler for multer
// ============================================================================
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, error: 'حجم الملف كبير جداً. الحد الأقصى 200MB' });
        }
        return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
});

module.exports = router;
