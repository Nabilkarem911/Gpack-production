-- Migration 026: Create Tasks Management Tables
-- Tables: tasks, task_subtasks, task_comments
-- For employee task assignment and tracking

-- =============================================================================
-- TABLE: tasks
-- Main tasks assigned to employees
-- =============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, cancelled
    priority VARCHAR(20) DEFAULT 'medium', -- high, medium, low
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for tasks
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- =============================================================================
-- TABLE: task_subtasks
-- Subtasks/checklist items for each main task
-- =============================================================================
CREATE TABLE IF NOT EXISTS task_subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_subtasks_task_id ON task_subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_task_subtasks_completed ON task_subtasks(is_completed);

-- =============================================================================
-- TABLE: task_comments
-- Comments and chat messages on tasks
-- =============================================================================
CREATE TABLE IF NOT EXISTS task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id UUID REFERENCES task_subtasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    attachments JSONB DEFAULT '[]', -- array of {filename, url}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_subtask_id ON task_comments(subtask_id) WHERE subtask_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at);

-- =============================================================================
-- TABLE: task_notifications
-- Notifications for task updates (for real-time features)
-- =============================================================================
CREATE TABLE IF NOT EXISTS task_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- recipient
    type VARCHAR(50) NOT NULL, -- assigned, due_soon, completed, commented
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_user_id ON task_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_is_read ON task_notifications(is_read) WHERE is_read = FALSE;

-- =============================================================================
-- Function: Update updated_at timestamp
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_subtasks_updated_at ON task_subtasks;
CREATE TRIGGER update_task_subtasks_updated_at
    BEFORE UPDATE ON task_subtasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- VIEW: Task Summary with Statistics
-- =============================================================================
CREATE OR REPLACE VIEW task_summary AS
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
LEFT JOIN task_subtasks ts ON ts.task_id = t.id AND ts.is_completed = true
GROUP BY t.id, u.name, cb.name;

-- Add sample tasks for testing (only if table is empty)
INSERT INTO tasks (title, description, assigned_to, due_date, status, priority)
SELECT 
    'تجهيز طلب شركة النور'::varchar(255),
    'تجهيز 500 كيس تغليف للعميل مع الطباعة الخاصة'::text,
    (SELECT id FROM users ORDER BY created_at LIMIT 1),
    CURRENT_DATE,
    'pending',
    'high'
WHERE NOT EXISTS (SELECT 1 FROM tasks LIMIT 1);

INSERT INTO tasks (title, description, assigned_to, due_date, status, priority)
SELECT 
    'صيانة الطابعة الرئيسية'::varchar(255),
    'الفحوصات الدورية للطابعة الكبيرة'::text,
    (SELECT id FROM users ORDER BY created_at OFFSET 1 LIMIT 1),
    CURRENT_DATE,
    'completed',
    'medium'
WHERE NOT EXISTS (SELECT 1 FROM tasks LIMIT 1);
