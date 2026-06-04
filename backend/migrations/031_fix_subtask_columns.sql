-- Migration 031: Fix subtask columns - add completed_by and completed_at if missing
DO $$
BEGIN
    -- Add completed_by if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'task_subtasks' AND column_name = 'completed_by') THEN
        ALTER TABLE task_subtasks ADD COLUMN completed_by UUID REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    
    -- Add completed_at if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'task_subtasks' AND column_name = 'completed_at') THEN
        ALTER TABLE task_subtasks ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;
