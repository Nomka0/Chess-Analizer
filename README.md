# Chess GM Analyzer ♟️🤖

A local, full-stack chess analysis application that combines the raw depth evaluation of **Stockfish 18 (WASM)** with tactical and strategic commentary from a **local Llama3 / Qwen2.5-Coder model (via Ollama)** acting as a Grandmaster Chess Coach.

---

## 🏗️ Structure

- **`frontend/`**: React (Vite) + Tailwind CSS v4 + `react-chessboard` + `chess.js` + `react-markdown`
- **`backend/`**: Node.js (Express) + CORS + `stockfish` (WASM) + `ollama` SDK

---

## 📋 Prerequisites

Ensure you have the following installed on your machine:
1. **Node.js** (v18+ recommended)
2. **Ollama** (Running locally on `http://localhost:11434`)
3. At least one of the following models pulled in Ollama:
   ```bash
   ollama pull llama3
   # OR
   ollama pull qwen2.5-coder
   ```

---

## 🚀 Getting Started

### Option A: The Fast Way (Root Scripts)

You can install and run both servers concurrently from the root directory:

1. **Install all dependencies:**
   ```bash
   npm run install-all
   ```

2. **Start both servers concurrently:**
   ```bash
   npm start
   ```

---

### Option B: Step-by-Step (Separate Terminals)

If you prefer to run and view logs in separate terminals:

#### 1. Backend Server Setup
```bash
cd backend
npm install
npm run dev
```
*The backend will start on [http://localhost:3000](http://localhost:3000).*

#### 2. Frontend Development Server Setup
```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```
*The Vite development server will start on [http://localhost:5173](http://localhost:5173).*

---

## 🧠 How It Works

1. **Move Pieces:** Drag and drop pieces on the chessboard. The state is validated using `chess.js`.
2. **Get FEN / Load custom FEN:** Copy the active FEN string, or paste a custom one and click **Cargar** to analyze any position.
3. **Analyze:** Click **Analizar Posición**.
4. **Stockfish Evaluation:** The backend routes the FEN to a queued, single-instance Stockfish WASM engine to execute a depth 10 search. It extracts the best move and numerical score.
5. **Grandmaster AI Commentary:** The backend queries your local Ollama instance with Llama3 (or falls back to Qwen2.5-Coder) using a custom system prompt. It describes the tactical threats, positional elements, and short-term plans .
6. **Markdown UI:** The frontend renders the coach's response with a high-fidelity Tailwind theme.
