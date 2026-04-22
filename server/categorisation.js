const categoryMap = {
  'Furniture': ['bookcase', 'chair', 'table', 'furnishing', 'sofa', 'desk'],
  'Technology': ['phone', 'machine', 'copier', 'accessory', 'printer', 'computer', 'cable', 'router'],
  'Office Supplies': ['label', 'storage', 'art', 'binder', 'appliance', 'paper', 'envelope', 'fastener', 'supply', 'pen', 'pencil', 'rubber', 'scissor']
};

export function categorizeTransaction(productName) {
  if (!productName) return 'Office Supplies';
  const lowerDesc = productName.toLowerCase();
  
  for (const [category, keywords] of Object.entries(categoryMap)) {
    for (const keyword of keywords) {
      if (lowerDesc.includes(keyword)) {
        return category;
      }
    }
  }
  
  return 'Office Supplies'; // Default
}
