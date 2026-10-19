-- Bersihkan mojibake pada data yang sudah ada di database.
-- Aman dijalankan berulang (hanya menyentuh baris yang cocok pola).
-- Dijalankan dari host: docker exec -i rigdaily-pg-dev psql -U rigdaily -d rigdaily < infra/sql/clean-mojibake.sql

-- equipment_status (jsonb)
UPDATE daily_reports
SET equipment_status = (
      replace(
        replace(
          replace(equipment_status::text, 'â€”', '-'),
          'â€“', '-'
        ),
        'ï¿½', ''
      )
    )::jsonb
WHERE equipment_status IS NOT NULL
  AND equipment_status::text ~ 'â€|Ã|Â|ï¿½';

-- kolom teks
UPDATE daily_reports
SET summary = replace(replace(replace(summary, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
WHERE summary IS NOT NULL AND summary ~ 'â€|Ã|Â|ï¿½';

UPDATE daily_reports
SET plan_next = replace(replace(replace(plan_next, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
WHERE plan_next IS NOT NULL AND plan_next ~ 'â€|Ã|Â|ï¿½';

UPDATE daily_reports
SET geology_notes = replace(replace(replace(geology_notes, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
WHERE geology_notes IS NOT NULL AND geology_notes ~ 'â€|Ã|Â|ï¿½';

UPDATE time_breakdown
SET iadc_subcode = replace(replace(iadc_subcode, 'â€”', '-'), 'â€™', '''')
WHERE iadc_subcode IS NOT NULL AND iadc_subcode ~ 'â€|Ã|Â|ï¿½';

UPDATE time_breakdown
SET remarks = replace(replace(replace(remarks, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
WHERE remarks IS NOT NULL AND remarks ~ 'â€|Ã|Â|ï¿½';

UPDATE safety_incidents
SET description = replace(replace(replace(description, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
WHERE description IS NOT NULL AND description ~ 'â€|Ã|Â|ï¿½';

UPDATE safety_incidents
SET immediate_action = replace(replace(immediate_action, 'â€”', '-'), 'â€™', '''')
WHERE immediate_action IS NOT NULL AND immediate_action ~ 'â€|Ã|Â|ï¿½';

UPDATE safety_incidents
SET corrective_action = replace(replace(corrective_action, 'â€”', '-'), 'â€™', '''')
WHERE corrective_action IS NOT NULL AND corrective_action ~ 'â€|Ã|Â|ï¿½';

UPDATE cost_lines
SET description = replace(replace(description, 'â€”', '-'), 'â€™', '''')
WHERE description IS NOT NULL AND description ~ 'â€|Ã|Â|ï¿½';

-- laporkan sisa
SELECT 'sisa_mojibake_ddr' AS cek, count(*)::int AS n
FROM daily_reports
WHERE coalesce(summary, '') ~ 'â€|Ã|Â|ï¿½'
   OR coalesce(plan_next, '') ~ 'â€|Ã|Â|ï¿½'
   OR coalesce(equipment_status::text, '') ~ 'â€|Ã|Â|ï¿½';
