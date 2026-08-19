const fs = require('fs');
const path = 'src/components/control/EmdisControlRoom.tsx';
let content = fs.readFileSync(path, 'utf8');

// Add import after existing ThermalResult import
if (!content.includes('IEC_DEFAULTS')) {
  content = content.replace(
    /import \{([^}]*)ThermalResult([^}]*)\} from "(@\/lib\/transformer-thermal|@\/lib\/thermal-constants)";/,
    'import {} from "";\nimport { IEC_DEFAULTS } from "@/lib/thermal-constants";'
  );
  // If the specific import line wasn't found, add after the transformer-thermal import
  if (!content.includes('IEC_DEFAULTS')) {
    content = content.replace(
      /import.*transformer-thermal.*;/,
      '$&\nimport { IEC_DEFAULTS } from "@/lib/thermal-constants";'
    );
  }
}

// Replace the thermalForCutaway object - add 4 fields before closing
const oldBlock =     headroomKva: 0,
    findings: [],
  };;

const newBlock =     headroomKva: 0,
    findings: [],
    constants: { ...IEC_DEFAULTS },
    constantsProvenance:
      "IEC 60076-7 defaults: R 5, top-oil rise 55 K, hot-spot gradient 23 K, x 0.8, y 1.6",
    lossRatioSource: "IEC default",
    ambientC: AMBIENT,
  };;

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(path, content);
  console.log('FIXED: EmdisControlRoom.tsx');
} else {
  console.log('WARNING: block not found - manual edit needed');
}

