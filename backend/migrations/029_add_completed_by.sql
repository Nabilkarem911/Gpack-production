-- Migration 029: Add completed_by column to task_subtasks if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'task_subtasks' AND column_name = 'completed_by') THEN
        ALTER TABLE task_subtasks ADD COLUMN completed_by UUID REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
