// Prescribing Conflict & Duplication Detection Engine
// Aligned with Indian Pharmacopoeia, generic formulations, and common brand names

const DRUG_CONFLICT_RULES = [
  {
    allergyKey: "Penicillin",
    displayName: "Penicillin & Beta-Lactam Class",
    conflicts: [
      { name: "penicillin", generic: "Penicillin", severity: "FATAL ANAPHYLAXIS", alternative: "Azithromycin 500mg OD or Clarithromycin" },
      { name: "amoxicillin", generic: "Amoxicillin", severity: "FATAL ANAPHYLAXIS", alternative: "Azithromycin 500mg OD or Doxycycline 100mg BD" },
      { name: "augmentin", generic: "Amoxicillin + Clavulanic Acid", severity: "FATAL ANAPHYLAXIS", alternative: "Cefixime (with caution) or Azithromycin" },
      { name: "moxikind", generic: "Amoxicillin + Clavulanic Acid", severity: "FATAL ANAPHYLAXIS", alternative: "Azithromycin 500mg" },
      { name: "ampicillin", generic: "Ampicillin", severity: "FATAL ANAPHYLAXIS", alternative: "Azithromycin or Ciprofloxacin" },
      { name: "piperacillin", generic: "Piperacillin + Tazobactam", severity: "HIGH RISK ANAPHYLAXIS", alternative: "Meropenem / Aminoglycosides" },
      { name: "cephalexin", generic: "Cephalexin (1st Gen Cephalosporin)", severity: "CROSS-REACTIVITY RISK (10%)", alternative: "Macrolide class" },
      { name: "cefuroxime", generic: "Cefuroxime", severity: "CROSS-REACTIVITY RISK", alternative: "Fluoroquinolones or Macrolides" }
    ]
  },
  {
    allergyKey: "NSAID",
    displayName: "NSAIDs & Salicylates Class",
    conflicts: [
      { name: "aspirin", generic: "Acetylsalicylic Acid", severity: "ANGIOEDEMA / GI BLEED", alternative: "Paracetamol 650mg SOS" },
      { name: "disprin", generic: "Soluble Aspirin", severity: "ANGIOEDEMA / GI BLEED", alternative: "Paracetamol 650mg SOS" },
      { name: "ibuprofen", generic: "Ibuprofen", severity: "BRONCHOSPASM / ANAPHYLACTOID", alternative: "Paracetamol 650mg or Tramadol" },
      { name: "brufen", generic: "Ibuprofen", severity: "BRONCHOSPASM / ANAPHYLACTOID", alternative: "Paracetamol 650mg" },
      { name: "combiflam", generic: "Ibuprofen + Paracetamol", severity: "SEVERE BRONCHOSPASM (Contains Ibuprofen)", alternative: "Pure Paracetamol (Calpol/Dolo 650)" },
      { name: "diclofenac", generic: "Diclofenac Sodium", severity: "SEVERE ASTHMA / GI ULCERATION", alternative: "Paracetamol 650mg or Topical Gel" },
      { name: "voveran", generic: "Diclofenac", severity: "SEVERE ASTHMA / GI ULCERATION", alternative: "Paracetamol or Tramadol" },
      { name: "naproxen", generic: "Naproxen", severity: "ANGIOEDEMA / ACUTE BRONCHOSPASM", alternative: "Paracetamol 650mg" },
      { name: "aceclofenac", generic: "Aceclofenac", severity: "SEVERE NSAID ALLERGIC REACTION", alternative: "Paracetamol 650mg" },
      { name: "zerodol", generic: "Aceclofenac", severity: "SEVERE NSAID ALLERGIC REACTION", alternative: "Paracetamol 650mg" },
      { name: "ketorolac", generic: "Ketorolac Tromethamine", severity: "HIGH SEVERITY ANAPHYLACTOID", alternative: "Tramadol 50mg" }
    ]
  },
  {
    allergyKey: "Sulfa",
    displayName: "Sulfonamide Class",
    conflicts: [
      { name: "bactrim", generic: "Sulfamethoxazole + Trimethoprim", severity: "STEVENS-JOHNSON SYNDROME (SJS)", alternative: "Ciprofloxacin or Nitrofurantoin" },
      { name: "cotrimoxazole", generic: "Cotrimoxazole", severity: "STEVENS-JOHNSON SYNDROME (SJS)", alternative: "Nitrofurantoin 100mg BD" },
      { name: "sulfamethoxazole", generic: "Sulfamethoxazole", severity: "STEVENS-JOHNSON SYNDROME (SJS)", alternative: "Cefixime 200mg BD" },
      { name: "septra", generic: "Cotrimoxazole", severity: "STEVENS-JOHNSON SYNDROME (SJS)", alternative: "Nitrofurantoin or Fosfomycin" }
    ]
  },
  {
    allergyKey: "Fluoroquinolone",
    displayName: "Fluoroquinolones Class",
    conflicts: [
      { name: "ciprofloxacin", generic: "Ciprofloxacin", severity: "QTc PROLONGATION / TENDON RUPTURE", alternative: "Cefixime 200mg BD or Amoxicillin" },
      { name: "ciplox", generic: "Ciprofloxacin", severity: "QTc PROLONGATION / TENDON RUPTURE", alternative: "Cefixime 200mg BD" },
      { name: "cifran", generic: "Ciprofloxacin", severity: "QTc PROLONGATION / TENDON RUPTURE", alternative: "Cefixime 200mg BD" },
      { name: "levofloxacin", generic: "Levofloxacin", severity: "ARRHYTHMIA / TENDONITIS", alternative: "Azithromycin 500mg" },
      { name: "ofloxacin", generic: "Ofloxacin", severity: "ARRHYTHMIA / SEVERE ALLERGY", alternative: "Cefuroxime or Azithromycin" },
      { name: "norfloxacin", generic: "Norfloxacin", severity: "ARRHYTHMIA / SEVERE ALLERGY", alternative: "Nitrofurantoin 100mg" }
    ]
  }
];

/**
 * Checks clinical notes or prescription input against patient allergies and active medications
 * @param {string} text - Doctor clinical notes or typed drug
 * @param {object} patient - Current patient record
 * @returns {object} { conflicts: [], duplicates: [] }
 */
function analyzePrescriptionConflicts(text, patient) {
  if (!text || !patient) return { conflicts: [], duplicates: [] };

  const normalized = text.toLowerCase();
  const detectedConflicts = [];
  const detectedDuplicates = [];
  const matchedDrugKeys = new Set();

  // 1. Check Drug-Allergy Conflicts
  const patientAllergies = patient.criticalAllergies || [];

  patientAllergies.forEach(allergy => {
    const allergenName = allergy.allergen.toLowerCase();
    
    DRUG_CONFLICT_RULES.forEach(rule => {
      const matchKey = rule.allergyKey.toLowerCase();
      if (allergenName.includes(matchKey) || matchKey.includes(allergenName.slice(0, 5))) {
        // This rule applies to this patient's allergy
        rule.conflicts.forEach(drugConflict => {
          const drugRegex = new RegExp(`\\b${drugConflict.name}\\b`, 'i');
          
          if (drugRegex.test(normalized)) {
            const conflictKey = `${allergy.allergen}-${drugConflict.generic.split(' ')[0]}`;
            if (!matchedDrugKeys.has(conflictKey)) {
              matchedDrugKeys.add(conflictKey);
              detectedConflicts.push({
                allergen: allergy.allergen,
                detectedDrug: drugConflict.generic,
                triggerWord: drugConflict.name,
                severity: drugConflict.severity,
                patientReaction: allergy.reaction,
                alternative: drugConflict.alternative
              });
            }
          }
        });
      }
    });
  });

  // 2. Check Duplication with Active Medications
  const activeMeds = patient.activeMedications || [];
  activeMeds.forEach(med => {
    const medWords = med.drug.toLowerCase().split(' ');
    const primaryName = medWords[0]; // e.g. "metformin", "telmisartan"
    if (primaryName.length > 3) {
      const medRegex = new RegExp(`\\b${primaryName}\\b`, 'i');
      if (medRegex.test(normalized)) {
        detectedDuplicates.push({
          drug: med.drug,
          dosage: med.dosage,
          prescribedBy: med.prescribedBy,
          remainingDays: med.remainingDays,
          reason: `Patient already actively taking this medication (${med.remainingDays} days supply remaining from ${med.prescribedBy}). Avoid double-dosing!`
        });
      }
    }
  });

  return {
    conflicts: detectedConflicts,
    duplicates: detectedDuplicates
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DRUG_CONFLICT_RULES,
    analyzePrescriptionConflicts
  };
}
