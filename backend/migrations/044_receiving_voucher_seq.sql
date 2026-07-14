-- Create a dedicated sequence for receiving_vouchers.voucher_number
-- Replaces the unsafe COALESCE(MAX+1) pattern that caused race conditions.
CREATE SEQUENCE IF NOT EXISTS receiving_voucher_number_seq START WITH 1 INCREMENT BY 1;

-- Set the starting value to max existing voucher_number + 1
DO $$
BEGIN
    DECLARE max_existing INTEGER;
    BEGIN
        SELECT COALESCE(MAX(voucher_number), 0) INTO max_existing FROM receiving_vouchers;
        IF max_existing > 0 THEN
            PERFORM setval('receiving_voucher_number_seq', max_existing);
        END IF;
    END;
END $$;

-- Alter the column to use the sequence as DEFAULT
ALTER TABLE receiving_vouchers ALTER COLUMN voucher_number SET DEFAULT nextval('receiving_voucher_number_seq');
ALTER TABLE receiving_vouchers ALTER COLUMN voucher_number SET NOT NULL;
