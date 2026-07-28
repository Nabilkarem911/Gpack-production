'use strict';

// =============================================================================
// G.PACK 2.0 — Storage Service
// Abstraction layer for file storage. Currently uses local filesystem.
// To switch to S3/MinIO/Azure, only change the _provider implementation here.
// Zero changes needed in approval-service or anywhere else.
//
// Usage:
//   const Storage = require('../services/storage-service');
//   await Storage.save(buffer, 'approvals/cert-123.pdf');
//   const path = await Storage.getPath('approvals/cert-123.pdf');
//   const exists = await Storage.exists('approvals/cert-123.pdf');
//   await Storage.delete('approvals/cert-123.pdf');
// =============================================================================

const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

// ── Provider: Local filesystem ──────────────────────────────────────────────
const LocalProvider = {

    async save(buffer, relativePath) {
        const fullPath = path.join(UPLOADS_DIR, relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, buffer);
        return fullPath;
    },

    async saveFromPath(sourcePath, relativePath) {
        const fullPath = path.join(UPLOADS_DIR, relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.copyFileSync(sourcePath, fullPath);
        return fullPath;
    },

    async getPath(relativePath) {
        return path.join(UPLOADS_DIR, relativePath);
    },

    async exists(relativePath) {
        const fullPath = path.join(UPLOADS_DIR, relativePath);
        return fs.existsSync(fullPath);
    },

    async delete(relativePath) {
        const fullPath = path.join(UPLOADS_DIR, relativePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    },

    async readBuffer(relativePath) {
        const fullPath = path.join(UPLOADS_DIR, relativePath);
        return fs.readFileSync(fullPath);
    },

    // Returns absolute path for WAHA (which needs filesystem access)
    toAbsolutePath(relativePath) {
        if (path.isAbsolute(relativePath)) return relativePath;
        return path.join(UPLOADS_DIR, relativePath);
    },

    // Returns relative path from uploads dir
    toRelativePath(absolutePath) {
        return path.relative(UPLOADS_DIR, absolutePath);
    }
};

// ── Future: S3Provider, MinIOProvider, AzureProvider ────────────────────────
// To add S3:
//   const S3Provider = { ...same interface, using aws-sdk... };
//   module.exports = process.env.STORAGE_PROVIDER === 's3' ? S3Provider : LocalProvider;

module.exports = LocalProvider;
