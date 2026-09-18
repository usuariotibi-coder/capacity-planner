export type PasswordStrength = 'weak' | 'medium' | 'strong';

export interface PasswordCriteria {
  minLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

export const getPasswordCriteria = (password: string): PasswordCriteria => {
  return {
    minLength: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^a-zA-Z\d]/.test(password),
  };
};

export const meetsPasswordSecurityRequirements = (password: string): boolean => {
  const criteria = getPasswordCriteria(password);
  return (
    criteria.minLength &&
    criteria.uppercase &&
    criteria.lowercase &&
    criteria.number &&
    criteria.special
  );
};

export const getPasswordStrength = (password: string): PasswordStrength => {
  if (password.length < 8) return 'weak';

  const criteria = getPasswordCriteria(password);
  let score = 0;
  if (password.length >= 12) score++;
  if (criteria.uppercase && criteria.lowercase) score++;
  if (criteria.number) score++;
  if (criteria.special) score++;

  if (score >= 3) return 'strong';
  if (score >= 2) return 'medium';
  return 'weak';
};
