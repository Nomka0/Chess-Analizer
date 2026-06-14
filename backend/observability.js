import fs from 'fs';
import path from 'path';

/**
 * TraceManager - Records and manages ReAct agent traces
 * Stores thought, action, and observation cycles for debugging
 */
export class TraceManager {
  constructor(options = {}) {
    this.maxTraces = options.maxTraces || 100;
    this.traceDir = options.traceDir || './traces';
    this.currentTraceId = null;
    this.traces = new Map(); // traceId -> { steps: [], metadata: {} }
    
    // Ensure trace directory exists
    if (!fs.existsSync(this.traceDir)) {
      fs.mkdirSync(this.traceDir, { recursive: true });
    }
  }

  /**
   * Start a new trace session
   * @param {Object} metadata - Initial metadata (fen, model, language, etc.)
   * @returns {string} traceId
   */
  startTrace(metadata = {}) {
    this.currentTraceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const trace = {
      traceId: this.currentTraceId,
      startedAt: new Date().toISOString(),
      metadata,
      steps: [],
      completedAt: null,
      finalResult: null,
      error: null
    };
    this.traces.set(this.currentTraceId, trace);
    
    // Auto-cleanup old traces if exceeding max
    if (this.traces.size > this.maxTraces) {
      const oldestKey = this.traces.keys().next().value;
      this.traces.delete(oldestKey);
    }
    
    return this.currentTraceId;
  }

  /**
   * Record a thought step
   * @param {string} thought - The agent's reasoning
   * @param {Object} [context] - Optional context data
   */
  recordThought(thought, context = {}) {
    if (!this.currentTraceId) return;
    const trace = this.traces.get(this.currentTraceId);
    if (!trace) return;
    
    trace.steps.push({
      type: 'thought',
      timestamp: new Date().toISOString(),
      content: thought,
      context
    });
  }

  /**
   * Record an action step (tool call)
   * @param {string} toolName - Name of the tool being called
   * @param {Object} params - Parameters passed to the tool
   * @param {string} [reasoning] - Why this action was chosen
   */
  recordAction(toolName, params, reasoning = '') {
    if (!this.currentTraceId) return;
    const trace = this.traces.get(this.currentTraceId);
    if (!trace) return;
    
    trace.steps.push({
      type: 'action',
      timestamp: new Date().toISOString(),
      tool: toolName,
      params,
      reasoning
    });
  }

  /**
   * Record an observation step (tool result)
   * @param {string} toolName - Name of the tool that was called
   * @param {Object} result - Result returned by the tool
   * @param {boolean} isError - Whether the result is an error
   */
  recordObservation(toolName, result, isError = false) {
    if (!this.currentTraceId) return;
    const trace = this.traces.get(this.currentTraceId);
    if (!trace) return;
    
    trace.steps.push({
      type: 'observation',
      timestamp: new Date().toISOString(),
      tool: toolName,
      result: isError ? { error: result?.message || String(result) } : result,
      isError
    });
  }

  /**
   * Record an error during the agent loop
   * @param {Error|string} error - The error that occurred
   * @param {string} [phase] - Phase where error occurred
   */
  recordError(error, phase = 'unknown') {
    if (!this.currentTraceId) return;
    const trace = this.traces.get(this.currentTraceId);
    if (!trace) return;
    
    trace.error = {
      message: error?.message || String(error),
      phase,
      timestamp: new Date().toISOString()
    };
    
    trace.steps.push({
      type: 'error',
      timestamp: new Date().toISOString(),
      error: error?.message || String(error),
      phase
    });
  }

  /**
   * Complete the current trace with final result
   * @param {Object} result - Final result from the agent
   */
  completeTrace(result) {
    if (!this.currentTraceId) return;
    const trace = this.traces.get(this.currentTraceId);
    if (!trace) return;
    
    trace.completedAt = new Date().toISOString();
    trace.finalResult = result;
    
    // Persist to file for debugging
    this._persistTrace(trace);
  }

  /**
   * Get a trace by ID
   * @param {string} traceId 
   * @returns {Object|null}
   */
  getTrace(traceId) {
    return this.traces.get(traceId) || null;
  }

  /**
   * Get the current active trace
   * @returns {Object|null}
   */
  getCurrentTrace() {
    if (!this.currentTraceId) return null;
    return this.traces.get(this.currentTraceId) || null;
  }

  /**
   * Get all trace IDs with basic metadata
   * @returns {Array}
   */
  listTraces() {
    return Array.from(this.traces.values()).map(t => ({
      traceId: t.traceId,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      stepCount: t.steps.length,
      hasError: !!t.error,
      metadata: t.metadata
    }));
  }

  /**
   * Clear all traces
   */
  clearTraces() {
    this.traces.clear();
    this.currentTraceId = null;
  }

  /**
   * Persist trace to file system
   * @private
   */
  _persistTrace(trace) {
    try {
      const filename = `${trace.traceId}.json`;
      const filepath = path.join(this.traceDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(trace, null, 2));
    } catch (err) {
      console.error('[TraceManager] Failed to persist trace:', err.message);
    }
  }

  /**
   * Export trace as formatted text for debugging
   * @param {string} traceId 
   * @returns {string}
   */
  exportTraceText(traceId) {
    const trace = this.traces.get(traceId);
    if (!trace) return `Trace ${traceId} not found`;
    
    let output = `=== Trace: ${trace.traceId} ===\n`;
    output += `Started: ${trace.startedAt}\n`;
    output += `Metadata: ${JSON.stringify(trace.metadata, null, 2)}\n\n`;
    
    for (const step of trace.steps) {
      output += `[${step.timestamp}] ${step.type.toUpperCase()}\n`;
      if (step.type === 'thought') {
        output += `  Thought: ${step.content}\n`;
        if (Object.keys(step.context || {}).length) {
          output += `  Context: ${JSON.stringify(step.context)}\n`;
        }
      } else if (step.type === 'action') {
        output += `  Tool: ${step.tool}\n`;
        output += `  Params: ${JSON.stringify(step.params)}\n`;
        if (step.reasoning) output += `  Reasoning: ${step.reasoning}\n`;
      } else if (step.type === 'observation') {
        output += `  Tool: ${step.tool}\n`;
        output += `  IsError: ${step.isError}\n`;
        output += `  Result: ${JSON.stringify(step.result).substring(0, 500)}\n`;
      } else if (step.type === 'error') {
        output += `  Error: ${step.error}\n`;
        output += `  Phase: ${step.phase}\n`;
      }
      output += '\n';
    }
    
    if (trace.finalResult) {
      output += `=== FINAL RESULT ===\n`;
      output += `${JSON.stringify(trace.finalResult, null, 2)}\n`;
    }
    
    return output;
  }
}

// Singleton instance for easy import
export const traceManager = new TraceManager();