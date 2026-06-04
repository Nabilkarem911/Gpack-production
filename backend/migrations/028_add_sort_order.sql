-- Migration 028: Add sort_order column to task_subtasks if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'task_subtasks' AND column_name = 'sort_order') THEN
        ALTER TABLE task_subtasks ADD COLUMN sort_order INTEGER DEFAULT 0;
    END IF;
END $$;
