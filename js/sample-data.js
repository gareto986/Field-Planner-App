// Sample inventory used to seed a brand-new database.
// Weights in kg, dimensions in cm, volumes/capacities in liters.
const I = (id, name, category, icon, weightKg, dims, extra = {}) => ({
  id, name, category, icon, weightKg,
  lengthCm: dims[0] || 0, widthCm: dims[1] || 0, heightCm: dims[2] || 0,
  volumeL: extra.volumeL || 0,
  qtyOwned: extra.qty ?? 1,
  useCases: extra.uses || [],
  environments: extra.env || ['all'],
  perPerson: !!extra.perPerson,
  consumable: !!extra.consumable,
  perPersonDay: extra.ppd || 0,
  capacityL: extra.cap || 0,
  maxLoadKg: extra.maxLoad || 0,
  notes: extra.notes || '',
  updated: new Date().toISOString().slice(0, 10),
});

export const SAMPLE_ITEMS = [
  // Containers
  I('CT-001', '65L Expedition Backpack', 'Container', '🎒', 2.1, [80, 35, 30], { qty: 2, cap: 65, maxLoad: 25, uses: ['backpacking', 'hiking', 'overnight'], notes: 'Hip belt, rain cover included' }),
  I('CT-002', '30L Daypack', 'Container', '🎒', 0.9, [50, 30, 20], { qty: 2, cap: 30, maxLoad: 12, uses: ['day-trip', 'hiking', 'survey'] }),
  I('CT-003', '70L Waterproof Duffel', 'Container', '👜', 1.4, [70, 40, 35], { qty: 1, cap: 70, maxLoad: 30, uses: ['vehicle', 'boat', 'flight'], env: ['coastal', 'wetland', 'all'] }),
  I('CT-004', '55L Rugged Tote', 'Container', '📦', 3.2, [60, 40, 35], { qty: 3, cap: 55, maxLoad: 40, uses: ['vehicle', 'basecamp'] }),
  I('CT-005', '20L Dry Bag', 'Container', '🛍️', 0.15, [45, 25, 25], { qty: 3, cap: 20, maxLoad: 10, uses: ['boat', 'rain', 'kayak'], env: ['coastal', 'wetland', 'tropical', 'all'] }),
  I('CT-006', 'Hard Case (Instruments)', 'Container', '🧳', 4.5, [50, 40, 20], { qty: 1, cap: 25, maxLoad: 20, uses: ['electronics', 'vehicle', 'flight', 'sampling'], notes: 'Foam insert, waterproof' }),

  // Clothing
  I('CL-001', 'Rain Shell Jacket', 'Clothing', '🧥', 0.4, [30, 20, 8], { qty: 3, perPerson: true, uses: ['rain', 'hiking', 'survey'], env: ['all'] }),
  I('CL-002', 'Insulated Puffy Jacket', 'Clothing', '🧥', 0.5, [30, 25, 15], { qty: 2, perPerson: true, uses: ['cold', 'overnight'], env: ['mountain', 'arctic', 'desert'] }),
  I('CL-003', 'Merino Base Layer Set', 'Clothing', '👕', 0.35, [25, 20, 6], { qty: 4, perPerson: true, uses: ['cold', 'overnight', 'hiking'], env: ['all'] }),
  I('CL-004', 'Field Pants', 'Clothing', '👖', 0.45, [30, 25, 5], { qty: 4, perPerson: true, uses: ['hiking', 'survey', 'sampling'], notes: 'Worn on travel day' }),
  I('CL-005', 'Wool Socks (pair)', 'Clothing', '🧦', 0.08, [15, 10, 4], { qty: 10, consumable: true, ppd: 1, uses: ['hiking', 'overnight'], notes: 'Plan one pair per person per day' }),
  I('CL-006', 'Sun Hat', 'Clothing', '👒', 0.1, [35, 35, 10], { qty: 3, perPerson: true, uses: ['hot', 'sun', 'survey'], env: ['desert', 'coastal', 'tropical', 'all'] }),
  I('CL-007', 'Work Gloves', 'Clothing', '🧤', 0.15, [25, 12, 3], { qty: 4, perPerson: true, uses: ['sampling', 'survey', 'basecamp'] }),
  I('CL-008', 'Waterproof Boots', 'Clothing', '🥾', 1.4, [32, 22, 15], { qty: 3, perPerson: true, uses: ['hiking', 'survey', 'worn'], notes: 'Worn, not packed' }),

  // Shelter & sleep
  I('SH-001', '2-Person Tent', 'Shelter', '⛺', 1.9, [50, 18, 18], { qty: 2, uses: ['overnight', 'camping', 'backpacking'] }),
  I('SH-002', 'Tarp 3x3m', 'Shelter', '🏕️', 0.6, [30, 15, 10], { qty: 1, uses: ['rain', 'basecamp', 'camping'] }),
  I('SL-001', 'Sleeping Bag (-7°C)', 'Sleep', '🛌', 1.2, [40, 22, 22], { qty: 3, perPerson: true, uses: ['overnight', 'camping', 'cold'] }),
  I('SL-002', 'Sleeping Pad', 'Sleep', '🟫', 0.6, [45, 12, 12], { qty: 3, perPerson: true, uses: ['overnight', 'camping'] }),

  // Cooking & food
  I('CK-001', 'Backpacking Stove', 'Cooking', '🔥', 0.25, [12, 10, 10], { qty: 1, uses: ['cooking', 'overnight'] }),
  I('CK-002', 'Fuel Canister 230g', 'Cooking', '🛢️', 0.37, [11, 11, 9], { qty: 6, consumable: true, ppd: 0.2, uses: ['cooking', 'overnight'] }),
  I('CK-003', 'Cook Pot Set', 'Cooking', '🍳', 0.4, [16, 16, 12], { qty: 1, uses: ['cooking', 'overnight'] }),
  I('FD-001', 'Dehydrated Meal', 'Food', '🍲', 0.15, [20, 15, 5], { qty: 30, consumable: true, ppd: 2, uses: ['overnight', 'cooking'] }),
  I('FD-002', 'Trail Mix (bag)', 'Food', '🥜', 0.2, [18, 12, 4], { qty: 20, consumable: true, ppd: 1, uses: ['hiking', 'day-trip', 'overnight', 'survey'] }),
  I('FD-003', 'Energy Bar', 'Food', '🍫', 0.06, [13, 4, 2], { qty: 40, consumable: true, ppd: 3, uses: ['hiking', 'day-trip', 'survey', 'sampling'] }),

  // Water
  I('WT-001', 'Squeeze Water Filter', 'Water', '💧', 0.1, [15, 6, 6], { qty: 2, uses: ['hiking', 'overnight', 'backpacking'] }),
  I('WT-002', '3L Hydration Bladder', 'Water', '🫗', 0.2, [40, 20, 3], { qty: 3, perPerson: true, uses: ['hiking', 'day-trip', 'hot'], env: ['desert', 'all'] }),
  I('WT-003', '20L Water Jug (empty)', 'Water', '🚰', 0.9, [35, 25, 30], { qty: 2, uses: ['vehicle', 'basecamp', 'hot'], env: ['desert', 'all'], notes: 'Adds 20 kg when full' }),
  I('WT-004', 'Purification Tablets', 'Water', '💊', 0.02, [8, 5, 2], { qty: 4, uses: ['emergency', 'overnight'] }),

  // Navigation & safety
  I('NV-001', 'Handheld GPS', 'Navigation', '🧭', 0.23, [16, 6, 4], { qty: 1, uses: ['navigation', 'survey', 'sampling'] }),
  I('NV-002', 'Topo Map & Compass', 'Navigation', '🗺️', 0.1, [25, 15, 1], { qty: 2, uses: ['navigation', 'hiking', 'emergency'] }),
  I('SF-001', 'First Aid Kit', 'Safety', '⛑️', 0.45, [20, 15, 8], { qty: 2, uses: ['emergency', 'hiking', 'survey', 'sampling'] }),
  I('SF-002', 'Satellite Messenger', 'Safety', '📡', 0.11, [10, 6, 3], { qty: 1, uses: ['emergency', 'remote', 'hiking'] }),
  I('SF-003', 'Bear Spray', 'Safety', '🐻', 0.3, [22, 6, 6], { qty: 2, uses: ['wildlife', 'hiking'], env: ['forest', 'mountain'] }),
  I('SF-004', 'Headlamp', 'Safety', '🔦', 0.09, [8, 6, 5], { qty: 3, perPerson: true, uses: ['overnight', 'emergency', 'camping'] }),
  I('SF-005', 'Emergency Bivy', 'Safety', '🆘', 0.1, [10, 8, 5], { qty: 3, perPerson: true, uses: ['emergency', 'cold'] }),
  I('SF-006', 'Sunscreen SPF50', 'Safety', '🧴', 0.12, [15, 5, 3], { qty: 3, uses: ['sun', 'hot', 'survey'], env: ['desert', 'coastal', 'tropical', 'mountain', 'all'] }),

  // Tools & electronics
  I('TL-001', 'Multitool', 'Tools', '🛠️', 0.25, [11, 4, 2], { qty: 2, uses: ['repair', 'survey', 'sampling'] }),
  I('TL-002', 'Folding Shovel', 'Tools', '⛏️', 0.6, [45, 15, 5], { qty: 1, uses: ['sampling', 'basecamp', 'vehicle'] }),
  I('TL-003', 'Static Rope 30m', 'Tools', '🪢', 1.0, [30, 30, 10], { qty: 1, uses: ['rescue', 'mountain', 'boat'], env: ['mountain', 'coastal'] }),
  I('TL-004', 'Duct Tape Roll', 'Tools', '🩹', 0.15, [10, 10, 5], { qty: 2, uses: ['repair'] }),
  I('EL-001', 'Power Bank 20,000mAh', 'Electronics', '🔋', 0.36, [15, 7, 2.5], { qty: 3, uses: ['electronics', 'overnight', 'survey'] }),
  I('EL-002', 'Folding Solar Panel 21W', 'Electronics', '☀️', 0.5, [28, 16, 3], { qty: 1, uses: ['electronics', 'basecamp', 'remote'], env: ['desert', 'mountain', 'coastal', 'all'] }),
  I('EL-003', 'Camera + Lens', 'Electronics', '📷', 0.9, [15, 12, 12], { qty: 1, uses: ['photography', 'survey', 'wildlife'] }),

  // Field science
  I('SC-001', 'Waterproof Field Notebook', 'Science', '📓', 0.2, [20, 13, 1.5], { qty: 5, perPerson: true, uses: ['survey', 'sampling', 'research'] }),
  I('SC-002', 'Sample Bags (50 pk)', 'Science', '🧪', 0.1, [20, 15, 3], { qty: 6, uses: ['sampling', 'research'] }),
  I('SC-003', 'Soil Probe', 'Science', '📏', 0.9, [100, 4, 4], { qty: 1, uses: ['sampling', 'research'], env: ['forest', 'wetland', 'desert', 'all'] }),
  I('SC-004', 'Data Logger Kit', 'Science', '📟', 0.3, [15, 10, 5], { qty: 2, uses: ['research', 'electronics', 'survey'] }),
  I('SC-005', 'Binoculars 10x42', 'Science', '🔭', 0.65, [15, 13, 6], { qty: 2, uses: ['wildlife', 'survey', 'research'] }),
];
