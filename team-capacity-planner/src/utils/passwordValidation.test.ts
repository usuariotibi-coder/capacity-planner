import { describe, it, expect } from 'vitest';
import {
  getPasswordCriteria,
  meetsPasswordSecurityRequirements,
  getPasswordStrength,
} from './passwordValidation';

describe('getPasswordCriteria', () => {
  it('flags every missing requirement on an empty password', () => {
    expect(getPasswordCriteria('')).toEqual({
      minLength: false,
      uppercase: false,
      lowercase: false,
      number: false,
      special: false,
    });
  });

  it('detects each criterion independently', () => {
    expect(getPasswordCriteria('Abcdefg1!')).toEqual({
      minLength: true,
      uppercase: true,
      lowercase: true,
      number: true,
      special: true,
    });
  });
});

describe('meetsPasswordSecurityRequirements', () => {
  it('rejects passwords missing a required class of character', () => {
    expect(meetsPasswordSecurityRequirements('alllowercase1')).toBe(false); // no uppercase/special
    expect(meetsPasswordSecurityRequirements('ALLUPPERCASE1')).toBe(false); // no lowercase/special
    expect(meetsPasswordSecurityRequirements('NoNumber!')).toBe(false); // no digit
    expect(meetsPasswordSecurityRequirements('Short1!')).toBe(false); // < 8 chars
  });

  it('accepts a password satisfying every requirement', () => {
    expect(meetsPasswordSecurityRequirements('Str0ng!Pass')).toBe(true);
  });
});

describe('getPasswordStrength', () => {
  it('rates short passwords as weak regardless of character variety', () => {
    expect(getPasswordStrength('Ab1!')).toBe('weak');
  });

  it('rates a long password with only lowercase as weak', () => {
    expect(getPasswordStrength('alllowercaseletters')).toBe('weak');
  });

  it('rates a password meeting some but not all criteria as medium', () => {
    expect(getPasswordStrength('Abcdefgh1')).toBe('medium');
  });

  it('rates a long password meeting every criterion as strong', () => {
    expect(getPasswordStrength('Str0ng!Password')).toBe('strong');
  });
});
