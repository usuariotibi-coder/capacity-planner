type AnyRecord = Record<string, any>;

const isValueEqual = (left: any, right: any) => {
  if (left === right) return true;
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

export const getChangedFields = <T extends AnyRecord>(
  original: T | undefined,
  updates: Partial<T>
) => {
  const changed: Partial<T> = {};
  if (!updates) return changed;

  const entries = Object.entries(updates);
  if (!original) {
    entries.forEach(([key, value]) => {
      if (value !== undefined) {
        (changed as AnyRecord)[key] = value;
      }
    });
    return changed;
  }

  entries.forEach(([key, value]) => {
    if (value === undefined) return;
    const previousValue = (original as AnyRecord)[key];
    if (!isValueEqual(previousValue, value)) {
      (changed as AnyRecord)[key] = value;
    }
  });

  return changed;
};
