'use strict';

// =============================================================================
// G.PACK 2.0 - Tasks Management Routes
// CRUD operations for tasks, subtasks, and comments
// =============================================================================

const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// =============================================================================
// GET /api/tasks
// List all tasks with optional filtering
// ROLE-BASED: Regular employees see only their tasks
// =============================================================================
router.get('/', authenticate, async (req, res) => {
    const { status, priority, assigned_to, overdue, limit = 50, offset = 0 } = req.query;
    
    try {
        let where = [];
        let params = [];
        let paramIdx = 1;
        
        // ROLE-BASED FILTERING:
        // - Admin/Super Admin: see all tasks
        // - Regular users: see only tasks assigned to them
        const userRole = req.user.role?.toLowerCase() || '';
        const isAdmin = ['super_admin', 'admin', 'manager'].includes(userRole);
        
        if (!isAdmin) {
            // Regular employee - show only their tasks
            where.push(`t.assigned_to = $${paramIdx++}`);
            params.push(req.user.id);
        }
        // Admins can see all tasks (no additional filter)
        
        if (status) {
            where.push(`t.status = $${paramIdx++}`);
            params.push(status);
        }
        
        if (priority) {
            where.push(`t.priority = $${paramIdx++}`);
            params.push(priority);
        }
        
        if (assigned_to && isAdmin) {
            // Only admins can filter by specific employee
            where.push(`t.assigned_to = $${paramIdx++}`);
            params.push(assigned_to);
        }
        
        if (overdue === 'true') {
            where.push(`t.due_date < CURRENT_DATE AND t.status != 'completed'`);
        }
        
        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
        
        // Get tasks with user names and subtask counts
        const tasksQuery = `
            SELECT 
                t.*,
                u.name as assigned_to_name,
                cb.name as created_by_name,
                COUNT(ts.id) as total_subtasks,
                COUNT(ts.id) FILTER (WHERE ts.is_completed = true) as completed_subtasks,
                CASE 
                    WHEN COUNT(ts.id) > 0 
                    THEN ROUND((COUNT(ts.id) FILTER (WHERE ts.is_completed = true)::numeric / COUNT(ts.id)::numeric) * 100, 0)
                    ELSE 0 
                END as progress_percentage
            FROM tasks t
            LEFT JOIN users u ON u.id = t.assigned_to
            LEFT JOIN users cb ON cb.id = t.created_by
            LEFT JOIN task_subtasks ts ON ts.task_id = t.id
            ${whereClause}
            GROUP BY t.id, u.name, cb.name
            ORDER BY 
                CASE t.status WHEN 'pending' THEN 0 ELSE 1 END,
                t.priority = 'high' DESC,
                t.due_date ASC,
                t.created_at DESC
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}
        `;
        
        params.push(parseInt(limit), parseInt(offset));
        
        const tasksResult = await db.query(tasksQuery, params);
        
        // Get total count for pagination
        const countQuery = `SELECT COUNT(*) FROM tasks t ${whereClause}`;
        const countResult = await db.query(countQuery, params.slice(0, -2)); // Remove limit/offset params
        
        res.json({
            tasks: tasksResult.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        
    } catch (error) {
        console.error('[Tasks] GET / error:', error);
        res.status(500).json({ error: 'Failed to load tasks' });
    }
});

// =============================================================================
// GET /api/tasks/:id
// Get single task with subtasks
// ROLE-BASED: Regular employees can only view their own tasks
// =============================================================================
router.get('/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Get task with user info
        const taskResult = await db.query(`
            SELECT 
                t.*,
                u.name as assigned_to_name,
                cb.name as created_by_name
            FROM tasks t
            LEFT JOIN users u ON u.id = t.assigned_to
            LEFT JOIN users cb ON cb.id = t.created_by
            WHERE t.id = $1
        `, [id]);
        
        if (taskResult.rowCount === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        const task = taskResult.rows[0];
        
        // Check permissions: only admin or assigned employee can view
        const userRole = req.user.role?.toLowerCase() || '';
        const isAdmin = ['super_admin', 'admin', 'manager'].includes(userRole);
        const isAssigned = task.assigned_to === req.user.id;
        
        if (!isAdmin && !isAssigned) {
            return res.status(403).json({ error: 'You can only view tasks assigned to you' });
        }
        
        // Get subtasks
        const subtasksResult = await db.query(`
            SELECT ts.*, u.name as completed_by_name
            FROM task_subtasks ts
            LEFT JOIN users u ON u.id = ts.completed_by
            WHERE ts.task_id = $1
            ORDER BY ts.sort_order, ts.created_at
        `, [id]);
        
        // Get recent comments
        const commentsResult = await db.query(`
            SELECT tc.*, u.name as user_name
            FROM task_comments tc
            JOIN users u ON u.id = tc.user_id
            WHERE tc.task_id = $1
            ORDER BY tc.created_at DESC
            LIMIT 20
        `, [id]);
        
        task.subtasks = subtasksResult.rows;
        task.comments = commentsResult.rows;
        
        res.json({ task });
        
    } catch (error) {
        console.error('[Tasks] GET /:id error:', error);
        res.status(500).json({ error: 'Failed to load task' });
    }
});

// =============================================================================
// POST /api/tasks
// Create new task
// =============================================================================
router.post('/', authenticate, async (req, res) => {
    const { title, description, assigned_to, due_date, priority = 'medium', order_id, client_id, subtasks = [] } = req.body;
    
    if (!title || !assigned_to || !due_date) {
        return res.status(400).json({ error: 'Title, assigned_to, and due_date are required' });
    }
    
    const client = await db.getClient();
    
    try {
        await client.query('BEGIN');
        
        // Create task
        const taskResult = await client.query(`
            INSERT INTO tasks (title, description, assigned_to, created_by, due_date, priority, order_id, client_id, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING *
        `, [title, description, assigned_to, req.user.id, due_date, priority, order_id, client_id]);
        
        const task = taskResult.rows[0];
        
        // Create subtasks if provided
        if (subtasks.length > 0) {
            for (let i = 0; i < subtasks.length; i++) {
                await client.query(`
                    INSERT INTO task_subtasks (task_id, title, description, sort_order)
                    VALUES ($1, $2, $3, $4)
                `, [task.id, subtasks[i].title, subtasks[i].description, i]);
            }
        }
        
        await client.query('COMMIT');
        
        res.status(201).json({ 
            task,
            message: 'Task created successfully'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Tasks] POST / error:', error);
        res.status(500).json({ error: 'Failed to create task' });
    } finally {
        client.release();
    }
});

// =============================================================================
// PUT /api/tasks/:id
// Update task
// ROLE-BASED: Regular employees can only update status of their own tasks
// =============================================================================
router.put('/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const { title, description, assigned_to, due_date, priority, status, order_id, client_id } = req.body;
    
    try {
        // Check user permissions
        const userRole = req.user.role?.toLowerCase() || '';
        const isAdmin = ['super_admin', 'admin', 'manager'].includes(userRole);
        
        // Get current task to check ownership
        const taskCheck = await db.query('SELECT assigned_to FROM tasks WHERE id = $1', [id]);
        if (taskCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        const isAssigned = taskCheck.rows[0].assigned_to === req.user.id;
        
        if (!isAdmin && !isAssigned) {
            return res.status(403).json({ error: 'You can only update tasks assigned to you' });
        }
        
        // Regular employees can only update status
        if (!isAdmin && isAssigned) {
            // Non-admin can only update status field
            if (status) {
                const updates = ['status = $1'];
                const params = [status];
                if (status === 'completed') {
                    updates.push('completed_at = NOW()');
                }
                updates.push('updated_at = NOW()');
                params.push(id);
                
                const result = await db.query(`
                    UPDATE tasks 
                    SET ${updates.join(', ')}
                    WHERE id = $${params.length}
                    RETURNING *
                `, params);
                
                return res.json({ task: result.rows[0], message: 'Task updated successfully' });
            } else {
                return res.status(403).json({ error: 'You can only update the status of your tasks' });
            }
        }
        
        // Admin can update all fields
        const updates = [];
        const params = [];
        let paramIdx = 1;
        
        if (title) { updates.push(`title = $${paramIdx++}`); params.push(title); }
        if (description !== undefined) { updates.push(`description = $${paramIdx++}`); params.push(description); }
        if (assigned_to) { updates.push(`assigned_to = $${paramIdx++}`); params.push(assigned_to); }
        if (due_date) { updates.push(`due_date = $${paramIdx++}`); params.push(due_date); }
        if (priority) { updates.push(`priority = $${paramIdx++}`); params.push(priority); }
        if (status) { 
            updates.push(`status = $${paramIdx++}`); 
            params.push(status);
            if (status === 'completed') {
                updates.push(`completed_at = NOW()`);
            }
        }
        if (order_id !== undefined) { updates.push(`order_id = $${paramIdx++}`); params.push(order_id); }
        if (client_id !== undefined) { updates.push(`client_id = $${paramIdx++}`); params.push(client_id); }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updates.push(`updated_at = NOW()`);
        params.push(id);
        
        const result = await db.query(`
            UPDATE tasks 
            SET ${updates.join(', ')}
            WHERE id = $${paramIdx}
            RETURNING *
        `, params);
        
        res.json({ task: result.rows[0], message: 'Task updated successfully' });
        
    } catch (error) {
        console.error('[Tasks] PUT /:id error:', error);
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// =============================================================================
// DELETE /api/tasks/:id
// Delete task
// ROLE-BASED: Only admins can delete tasks
// =============================================================================
router.delete('/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Check user permissions
        const userRole = req.user.role?.toLowerCase() || '';
        const isAdmin = ['super_admin', 'admin', 'manager'].includes(userRole);
        
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only administrators can delete tasks' });
        }
        
        const result = await db.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        res.json({ message: 'Task deleted successfully' });
        
    } catch (error) {
        console.error('[Tasks] DELETE /:id error:', error);
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// =============================================================================
// POST /api/tasks/:id/subtasks
// Add subtask to task
// =============================================================================
router.post('/:id/subtasks', authenticate, async (req, res) => {
    const { id } = req.params;
    const { title, description, sort_order = 0 } = req.body;
    
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    try {
        const result = await db.query(`
            INSERT INTO task_subtasks (task_id, title, description, sort_order)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [id, title, description, sort_order]);
        
        res.status(201).json({ subtask: result.rows[0] });
        
    } catch (error) {
        console.error('[Tasks] POST /:id/subtasks error:', error);
        res.status(500).json({ error: 'Failed to add subtask' });
    }
});

// =============================================================================
// PUT /api/tasks/:id/subtasks/:subtaskId
// Update subtask (toggle completion)
// =============================================================================
router.put('/:id/subtasks/:subtaskId', authenticate, async (req, res) => {
    const { id, subtaskId } = req.params;
    const { is_completed, title, description } = req.body;
    
    try {
        const updates = [];
        const params = [];
        let paramIdx = 1;
        
        if (title) { updates.push(`title = $${paramIdx++}`); params.push(title); }
        if (description !== undefined) { updates.push(`description = $${paramIdx++}`); params.push(description); }
        if (is_completed !== undefined) { 
            updates.push(`is_completed = $${paramIdx++}`); 
            params.push(is_completed);
            if (is_completed) {
                updates.push(`completed_by = $${paramIdx++}`);
                params.push(req.user.id);
                updates.push(`completed_at = NOW()`);
            } else {
                updates.push(`completed_by = NULL`);
                updates.push(`completed_at = NULL`);
            }
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updates.push(`updated_at = NOW()`);
        params.push(subtaskId);
        
        const result = await db.query(`
            UPDATE task_subtasks 
            SET ${updates.join(', ')}
            WHERE id = $${paramIdx} AND task_id = $${paramIdx + 1}
            RETURNING *
        `, [...params, id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Subtask not found' });
        }
        
        res.json({ subtask: result.rows[0] });
        
    } catch (error) {
        console.error('[Tasks] PUT /:id/subtasks/:subtaskId error:', error);
        res.status(500).json({ error: 'Failed to update subtask' });
    }
});

// =============================================================================
// DELETE /api/tasks/:id/subtasks/:subtaskId
// Delete subtask
// =============================================================================
router.delete('/:id/subtasks/:subtaskId', authenticate, async (req, res) => {
    const { id, subtaskId } = req.params;
    
    try {
        const result = await db.query(
            'DELETE FROM task_subtasks WHERE id = $1 AND task_id = $2 RETURNING id',
            [subtaskId, id]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Subtask not found' });
        }
        
        res.json({ message: 'Subtask deleted successfully' });
        
    } catch (error) {
        console.error('[Tasks] DELETE /:id/subtasks/:subtaskId error:', error);
        res.status(500).json({ error: 'Failed to delete subtask' });
    }
});

// =============================================================================
// POST /api/tasks/:id/comments
// Add comment to task
// =============================================================================
router.post('/:id/comments', authenticate, async (req, res) => {
    const { id } = req.params;
    const { comment, subtask_id, attachments = [] } = req.body;
    
    if (!comment || !comment.trim()) {
        return res.status(400).json({ error: 'Comment is required' });
    }
    
    try {
        const result = await db.query(`
            INSERT INTO task_comments (task_id, subtask_id, user_id, comment, attachments)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *, (SELECT name FROM users WHERE id = $3) as user_name
        `, [id, subtask_id || null, req.user.id, comment.trim(), JSON.stringify(attachments)]);
        
        res.status(201).json({ comment: result.rows[0] });
        
    } catch (error) {
        console.error('[Tasks] POST /:id/comments error:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// =============================================================================
// GET /api/tasks/dashboard/summary
// Dashboard summary of tasks (for dashboard widget)
// =============================================================================
router.get('/dashboard/summary', authenticate, async (req, res) => {
    try {
        // Get counts by status
        const countsResult = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending' AND due_date >= CURRENT_DATE) as pending,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'pending' AND due_date < CURRENT_DATE) as overdue,
                COUNT(*) as total
            FROM tasks
        `);
        
        // Get today's and overdue tasks (max 5)
        const tasksResult = await db.query(`
            SELECT 
                t.*,
                u.name as assigned_to_name
            FROM tasks t
            LEFT JOIN users u ON u.id = t.assigned_to
            WHERE t.status = 'pending'
                AND (t.due_date = CURRENT_DATE OR t.due_date < CURRENT_DATE)
            ORDER BY 
                CASE WHEN t.due_date < CURRENT_DATE THEN 0 ELSE 1 END,
                t.priority = 'high' DESC,
                t.due_date ASC
            LIMIT 5
        `);
        
        res.json({
            counts: countsResult.rows[0],
            urgent_tasks: tasksResult.rows
        });
        
    } catch (error) {
        console.error('[Tasks] GET /dashboard/summary error:', error);
        res.status(500).json({ error: 'Failed to load task summary' });
    }
});

module.exports = router;
