/**
 * Utility to clean localStorage data
 */

export const clearCapacityStorage = () => {
  const capacityKeys = [
    'scioTeamMembers',
    'subcontractedPersonnel',
    'prgExternalPersonnel',
  ];

  capacityKeys.forEach((key) => {
    localStorage.removeItem(key);
  });

  console.log('✓ Cleared capacity storage:', capacityKeys);
};

export const clearAllAppStorage = () => {
  // Clear capacity data
  clearCapacityStorage();

  // Clear auth tokens (if needed)
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');

  console.log('✓ Cleared all app storage');
};

export const clearOnlyLocalStorage = () => {
  // Only clear localStorage capacity data, NOT backend
  clearCapacityStorage();
};
