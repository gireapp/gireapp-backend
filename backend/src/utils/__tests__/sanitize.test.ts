import { describe, it, expect } from 'vitest';
import {
  detectThreats,
  detectThreatsInBody,
  sanitizeString,
  sanitizeObject,
} from '../sanitize';

function body(fields: Record<string, string>): string {
  return JSON.stringify(fields);
}

describe('detectThreats — determinism', () => {
  // The patterns are module-level and carry /g/ state. A stale lastIndex used to
  // make the same payload alternate between blocked and allowed, which let a real
  // attack through on a retry.
  it('returns the same verdict for the same malicious input across calls', () => {
    const payload = body({ email: "admin' OR 1=1 --@example.com" });

    const verdicts = Array.from({ length: 6 }, () => detectThreats(payload));

    expect(verdicts.every((v) => v.includes('sql_injection'))).toBe(true);
  });

  it('returns the same verdict for the same benign input across calls', () => {
    const payload = body({ email: 'j0xf3k2a@mozmail.com', name: 'Jide' });

    const verdicts = Array.from({ length: 6 }, () => detectThreats(payload));

    expect(verdicts.every((v) => v.length === 0)).toBe(true);
  });

  it('does not let a malicious payload leak through after a benign one', () => {
    detectThreats(body({ name: 'Jide' }));
    detectThreats(body({ email: 'x@example.com' }));

    expect(detectThreats(body({ q: 'UNION SELECT password FROM users' }))).toContain(
      'sql_injection'
    );
  });

  it('does not carry a match forward onto the next benign payload', () => {
    detectThreats(body({ q: 'UNION SELECT password FROM users' }));

    expect(detectThreats(body({ name: 'Jide Adewale' }))).toEqual([]);
  });
});

describe('detectThreats — hex literals', () => {
  it('ignores "0x" buried inside a random email alias', () => {
    expect(detectThreats(body({ email: 'j0xf3k2a@mozmail.com' }))).toEqual([]);
  });

  it('ignores a mid-token hex run that is not a standalone literal', () => {
    expect(detectThreats(body({ name: 'user0xabcz' }))).toEqual([]);
  });

  it('still flags a standalone hex literal', () => {
    expect(detectThreats(body({ q: 'SELECT 0x414243' }))).toContain('sql_injection');
  });

  it('still flags a hex literal delimited by punctuation', () => {
    expect(detectThreats(body({ q: 'id=(0xdeadbeef)' }))).toContain('sql_injection');
  });
});

describe('detectThreats — genuine attacks still caught', () => {
  it.each([
    ['classic tautology', "' OR 1=1"],
    ['union select', 'UNION SELECT username FROM accounts'],
    ['schema enumeration', 'SELECT * FROM INFORMATION_SCHEMA.TABLES'],
    ['time-based', "'; WAITFOR DELAY '0:0:5'"],
  ])('flags %s', (_label, payload) => {
    expect(detectThreats(body({ q: payload }))).toContain('sql_injection');
  });

  it.each([
    ['script tag', '<script>alert(1)</script>'],
    ['event handler', '<img src=x onerror="alert(1)">'],
    ['javascript uri', '<a href="javascript:alert(1)">x</a>'],
  ])('flags %s', (_label, payload) => {
    expect(detectThreats(body({ bio: payload }))).toContain('xss');
  });
});

describe('detectThreatsInBody — credentials are never scanned', () => {
  it.each([
    ['semicolon', 'Tr0ub4dor;x'],
    ['double hyphen', 'Tr0ub4dor--x'],
    ['hex-looking run', '0xC0FFEE99'],
    ['sql keyword', 'DROP TABLE hunter2'],
  ])('accepts a password containing a %s', (_label, password) => {
    expect(
      detectThreatsInBody({ email: 'jide@example.com', password, confirmPassword: password })
    ).toEqual([]);
  });

  it('accepts an opaque one-time token', () => {
    expect(detectThreatsInBody({ token: '0xdeadbeef;--' })).toEqual([]);
  });
});

describe('detectThreatsInBody — schema-constrained fields are skipped', () => {
  it.each([
    'j0xf3k2a@mozmail.com',
    'union.hare21@mozmail.com',
    'select-badger@mozmail.com',
    'drop.anchor7@mozmail.com',
  ])('accepts the generated email alias %s', (email) => {
    expect(detectThreatsInBody({ email })).toEqual([]);
  });

  it('skips date and enum fields', () => {
    expect(
      detectThreatsInBody({
        dateOfBirth: '1998-04-12',
        academicLevel: 'TERTIARY',
        moodTheme: 'calm',
      })
    ).toEqual([]);
  });
});

describe('detectThreatsInBody — free text is still scanned', () => {
  it('flags an injection attempt in a free-text field', () => {
    expect(detectThreatsInBody({ name: "admin' OR 1=1 --" })).toContain('sql_injection');
  });

  it('flags XSS in a nested free-text field', () => {
    expect(
      detectThreatsInBody({ profile: { bio: '<script>alert(1)</script>' } })
    ).toContain('xss');
  });

  it('flags an injection attempt inside an array', () => {
    expect(
      detectThreatsInBody({ tags: ['fine', 'UNION SELECT password FROM users'] })
    ).toContain('sql_injection');
  });

  it('keeps the semicolon rule active on free text', () => {
    expect(detectThreatsInBody({ department: 'Law; Civil' })).toContain('sql_injection');
  });

  it('leaves an ordinary registration body alone', () => {
    expect(
      detectThreatsInBody({
        name: 'Jide Adewale',
        email: 'union.ekpo@example.com',
        password: 'Passw0rd;--',
        dateOfBirth: '1998-04-12',
        track: 'Tertiary',
        department: 'Engineering',
      })
    ).toEqual([]);
  });

  // KNOWN FALSE POSITIVE, pinned so it stays visible. The keyword rule matches a
  // SQL verb followed by whitespace, which real names satisfy. Per-field scanning
  // does not help here — the collision is inside the single `name` value. Fixing
  // it means narrowing the keyword rule (e.g. requiring adjacent SQL syntax), not
  // changing where the scan runs. Delete this test when that rule is tightened.
  it('still rejects a legitimate name that collides with a SQL keyword', () => {
    expect(detectThreatsInBody({ name: 'Union Ekpo' })).toContain('sql_injection');
    expect(detectThreatsInBody({ name: 'Cast Iron' })).toContain('sql_injection');
  });
});

describe('detectThreatsInBody — no cross-field matches', () => {
  it('does not synthesise a match from two separately harmless fields', () => {
    // "SELECT" and "1=1" only sit next to each other once the body is
    // flattened into a single JSON string.
    expect(detectThreatsInBody({ first: 'SELECT', second: '1=1' })).toEqual([]);
  });
});

describe('sanitizeString', () => {
  it('strips script tags', () => {
    expect(sanitizeString('<script>alert(1)</script>hello')).toBe('hello');
  });

  it('escapes angle brackets and quotes that remain', () => {
    expect(sanitizeString('5 > 3')).toBe('5 &gt; 3');
  });

  it('leaves an ordinary name untouched apart from trimming', () => {
    expect(sanitizeString('  Jide Adewale  ')).toBe('Jide Adewale');
  });
});

describe('sanitizeObject', () => {
  it('sanitises nested string values', () => {
    const result = sanitizeObject({
      name: '<script>bad</script>Jide',
      nested: { note: '<iframe src="x"></iframe>ok' },
    });

    expect(result.name).toBe('Jide');
    expect(result.nested.note).toContain('ok');
    expect(result.nested.note).not.toContain('<iframe');
  });

  it('leaves non-string values alone', () => {
    const result = sanitizeObject({ points: 50, active: true, missing: null });

    expect(result).toEqual({ points: 50, active: true, missing: null });
  });
});
