// Test script for validation system - simple version without Stockfish
import { validateAnalysisAgainstBoard } from './backend/validation.js';

// Test position where black queen IS on a5
// FEN with black queen on a5: put q on a5 (rank 4 from white's perspective = rank 5 from black)
// r1b1kbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 6
// Let's create a FEN with queen on a5:
// Rank 8: r1b1kbnr
// Rank 7: pppp1ppp
// Rank 6: 2n5
// Rank 5: q3p3  <- queen on a5 (from white's perspective, rank 4 is a5)
// Rank 4: 4P3
// Rank 3: 5N2
// Rank 2: PPPP1PPP
// Rank 1: RNBQKB1R
const fenQa5 = 'r1b1kbnr/pppp1ppp/2n5/q3p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 6';

console.log('Test FEN:', fenQa5);

console.log('\n=== Test 1: Full analysis with hallucination (queen on a5 attacks e2 - FALSE) ===');
const analysisWithHallucination = `
**1. e4** es un/una **excelente** (0cp). El movimiento controla el centro y prepara el desarrollo.

# Contras:
- La reina negra en a5 ataca el peón en e2, creando presión inmediata.
<details>
<summary>Ataque a e2</summary>
<div class="variation">1. e4 Qa5</div>
</details>

# Pros:
- El peón en e4 controla las casillas centrales d5 y f5.
<details>
<summary>Control Central</summary>
<div class="variation">1. e4 e5 2. Nf3 Nc6</div>
</details>

--- 

# La alternativa correcta: 1. e4
El movimiento 1.e4 es el mejor movimiento y establece control central.
<details>
<summary>Ver continuación sugerida</summary>
<div class="variation">1. e4 e5 2. Nf3 Nc6 3. Bb5</div>
</details>
`;

const validation = validateAnalysisAgainstBoard(analysisWithHallucination, fenQa5, 'black');
console.log('Valid:', validation.valid);
console.log('Corrections:', validation.corrections.length);
validation.corrections.forEach(c => console.log('  -', c));
console.log('Warnings:', validation.warnings.length);
validation.warnings.forEach(w => console.log('  -', w));
console.log('\nValidated Analysis (first 500 chars):');
console.log(validation.validatedAnalysis.substring(0, 500));

// Test 2: Valid analysis (no hallucination) - correct attack on d2
console.log('\n=== Test 2: Valid analysis (queen on a5 attacks d2 - TRUE) ===');
const validAnalysis = `
**1... Qa5** es un/una **bueno** (20cp). La reina ataca el peón en d2.
`;

const validation2 = validateAnalysisAgainstBoard(validAnalysis, fenQa5, 'black');
console.log('Valid:', validation2.valid);
console.log('Corrections:', validation2.corrections.length);
validation2.corrections.forEach(c => console.log('  -', c));
console.log('Warnings:', validation2.warnings.length);

// Test 3: Test vague attack "ataca el peón en e2" 
console.log('\n=== Test 3: Vague attack claim (ataca el peón en e2 - FALSE) ===');
const vagueAnalysis = `
**1... Qa5** es un/una **imprecisión** (50cp). La reina ataca el peón en e2.
`;

const validation3 = validateAnalysisAgainstBoard(vagueAnalysis, fenQa5, 'black');
console.log('Valid:', validation3.valid);
console.log('Corrections:', validation3.corrections.length);
validation3.corrections.forEach(c => console.log('  -', c));
console.log('Warnings:', validation3.warnings.length);
console.log('\nValidated Analysis:');
console.log(validation3.validatedAnalysis);

// Test 4: Test "ataca el peón en d2" (correct - queen on a5 attacks d2)
console.log('\n=== Test 4: Correct attack claim (d2) ===');
const correctAnalysis = `
**1... Qa5** es un/una **bueno** (20cp). La reina ataca el peón en d2.
`;

const validation4 = validateAnalysisAgainstBoard(correctAnalysis, fenQa5, 'black');
console.log('Valid:', validation4.valid);
console.log('Corrections:', validation4.corrections.length);
validation4.corrections.forEach(c => console.log('  -', c));
console.log('Warnings:', validation4.warnings.length);

// Test 5: Test pin detection - bishop on b5 pinning knight on c6 to king on e8
// FEN after 1.e4 e5 2.Nf3 Nc6 3.Bb5
// r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3
const fenPin = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';

console.log('\nPin test FEN:', fenPin);

console.log('\n=== Test 5: Correct pin claim (bishop on b5 pins knight on c6) ===');
const pinAnalysis = `
**3... a6** es un/una **mejor** (0cp). El alfil en b5 clava el caballo en c6.
`;

const validation5 = validateAnalysisAgainstBoard(pinAnalysis, fenPin, 'black');
console.log('Valid:', validation5.valid);
console.log('Corrections:', validation5.corrections.length);
validation5.corrections.forEach(c => console.log('  -', c));
console.log('Warnings:', validation5.warnings.length);

// Test 6: False pin claim - bishop on b5 pinning knight on d7 (no knight on d7)
console.log('\n=== Test 6: False pin claim (bishop on b5 pins knight on d7) ===');
const falsePinAnalysis = `
**3... a6** es un/una **mejor** (0cp). El alfil en b5 clava el caballo en d7.
`;

const validation6 = validateAnalysisAgainstBoard(falsePinAnalysis, fenPin, 'black');
console.log('Valid:', validation6.valid);
console.log('Corrections:', validation6.corrections.length);
validation6.corrections.forEach(c => console.log('  -', c));
console.log('Warnings:', validation6.warnings.length);

// Test 7: English text test
console.log('\n=== Test 7: English text - Queen on a5 attacks pawn on e2 ===');
const englishAnalysis = `
**1. e4** is an **excellent** move (0cp). The move controls the center.

# Cons:
- The black queen on a5 attacks the pawn on e2, creating immediate pressure.
<details>
<summary>Attack on e2</summary>
<div class="variation">1. e4 Qa5</div>
</details>

# Pros:
- The pawn on e4 controls central squares d5 and f5.
<details>
<summary>Central Control</summary>
<div class="variation">1. e4 e5 2. Nf3 Nc6</div>
</details>

--- 

# The correct alternative: 1. e4
The move 1.e4 is the best move and establishes central control.
<details>
<summary>See suggested continuation</summary>
<div class="variation">1. e4 e5 2. Nf3 Nc6 3. Bb5</div>
</details>
`;

const validation7 = validateAnalysisAgainstBoard(englishAnalysis, fenQa5, 'black');
console.log('Valid:', validation7.valid);
console.log('Corrections:', validation7.corrections.length);
validation7.corrections.forEach(c => console.log('  -', c));
console.log('Warnings:', validation7.warnings.length);

console.log('\n=== All tests completed ===');