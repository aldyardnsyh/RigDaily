-- Bersihkan mojibake pada tabel yang belum tercakup clean-mojibake.sql.
-- Aman diulang: hanya menyentuh baris yang cocok pola.

UPDATE safety_incidents SET type = replace(replace(replace(type, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
  WHERE type ~ 'â€|Ã|Â|ï¿½';
UPDATE safety_incidents SET immediate_action = replace(replace(replace(immediate_action, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
  WHERE immediate_action ~ 'â€|Ã|Â|ï¿½';
UPDATE safety_incidents SET corrective_action = replace(replace(replace(corrective_action, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
  WHERE corrective_action ~ 'â€|Ã|Â|ï¿½';
UPDATE safety_incidents SET location = replace(replace(replace(location, 'â€”', '-'), 'â€“', '-'), 'â€™', '''')
  WHERE location ~ 'â€|Ã|Â|ï¿½';
UPDATE safety_incidents SET assignee = replace(replace(assignee, 'â€”', '-'), 'â€™', '''')
  WHERE assignee ~ 'â€|Ã|Â|ï¿½';

UPDATE crew_members SET position = replace(replace(position, 'â€”', '-'), 'â€™', '''')
  WHERE position ~ 'â€|Ã|Â|ï¿½';
UPDATE crew_members SET company = replace(replace(company, 'â€”', '-'), 'â€™', '''')
  WHERE company ~ 'â€|Ã|Â|ï¿½';

UPDATE users SET name = replace(replace(name, 'â€”', '-'), 'â€™', '''')
  WHERE name ~ 'â€|Ã|Â|ï¿½';

UPDATE wells SET operator = replace(replace(operator, 'â€”', '-'), 'â€™', '''')
  WHERE operator ~ 'â€|Ã|Â|ï¿½';

UPDATE equipment SET name = replace(replace(name, 'â€”', '-'), 'â€™', '''')
  WHERE name ~ 'â€|Ã|Â|ï¿½';
UPDATE vendors SET name = replace(replace(name, 'â€”', '-'), 'â€™', '''')
  WHERE name ~ 'â€|Ã|Â|ï¿½';

UPDATE distribution_rules SET name = replace(replace(name, 'â€”', '-'), 'â€™', '''')
  WHERE name ~ 'â€|Ã|Â|ï¿½';

UPDATE rate_cards SET label = replace(replace(label, 'â€”', '-'), 'â€™', '''')
  WHERE label ~ 'â€|Ã|Â|ï¿½';

UPDATE audit_log SET actor_name = replace(replace(actor_name, 'â€”', '-'), 'â€™', '''')
  WHERE actor_name ~ 'â€|Ã|Â|ï¿½';

-- Laporkan sisa
SELECT 'sisa_safety_type' AS cek, count(*)::int AS n FROM safety_incidents WHERE type ~ 'â€|Ã|Â|ï¿½';
