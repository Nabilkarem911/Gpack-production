'use strict';

// =============================================================================
// G.PACK 2.0 — Standardized API Response Helpers
// Ensures consistent response format across all endpoints
// Maintains backward compatibility with existing frontend code
// =============================================================================

/**
 * Success response with data
 * @param {Object} res - Express response object
 * @param {*} data - Data to return
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {Object} JSON response
 */
const success = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({ 
    success: true,  // For backward compatibility
    data,
    message: 'Success',
    total: Array.isArray(data) ? data.length : undefined
  });
};

/**
 * Error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @returns {Object} JSON response
 */
const error = (res, message, statusCode = 500) => {
  return res.status(statusCode).json({ 
    success: false,  // For backward compatibility
    error: message,
    message: message
  });
};

/**
 * Paginated response
 * @param {Object} res - Express response object
 * @param {Array} data - Array of data items
 * @param {number} total - Total count of items
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {Object} JSON response
 */
const paginated = (res, data, total, page, limit) => {
  return res.json({
    success: true,  // For backward compatibility
    data,
    message: 'Success',
    total,
    pagination: { 
      total, 
      page: parseInt(page), 
      limit: parseInt(limit), 
      pages: Math.ceil(total / limit) 
    }
  });
};

/**
 * Created response (for POST requests)
 * @param {Object} res - Express response object
 * @param {*} data - Created resource data
 * @param {string} message - Success message
 * @returns {Object} JSON response
 */
const created = (res, data, message = 'Resource created successfully') => {
  return res.status(201).json({
    success: true,
    data,
    message
  });
};

/**
 * No content response (for DELETE requests)
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @returns {Object} JSON response
 */
const noContent = (res, message = 'Resource deleted successfully') => {
  return res.status(200).json({
    success: true,
    message
  });
};

module.exports = { 
  success, 
  error, 
  paginated,
  created,
  noContent
};
