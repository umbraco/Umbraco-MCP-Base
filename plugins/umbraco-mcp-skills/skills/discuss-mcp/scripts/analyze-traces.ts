#!/usr/bin/env npx tsx
/**
 * Analyze MCP Eval Traces
 *
 * Parses eval test output into structured metrics that surface improvement
 * opportunities. Reads from a log file or runs evals and captures stdout.
 *
 * Parses the structured output from logTestResult() format:
 *   === {testName} ===
 *   Tools available: tool1, tool2, ...
 *   Tools called: tool1, tool2, tool1, ...
 *   Final result preview: ...
 *   Cost: $0.0123
 *   Tokens: 1234 (in: 1000, out: 234)
 *   Turns: 3
 *   Success: true
 *
 * Environment variables:
 *   PROJECT_ROOT  - Consumer project root (default: ".")
 *   COLLECTION    - Optional filter to a single collection
 *   LOG_FILE      - Optional path to a pre-captured eval log file
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface ScenarioMetrics {
  name: string;
  toolsAvailable: string[];
  toolsCalled: string[];
  cost: number;
  tokens: { input: number; output: number; total: number };
  turns: number;
  success: boolean;
}

interface ToolFrequency {
  tool: string;
  count: number;
  scenarios: string[];
}

interface ImprovementCandidate {
  scenario: string;
  signal: string;
  detail: string;
}

/**
 * Parse a single scenario block from logTestResult() output.
 */
function parseScenarioBlock(block: string): ScenarioMetrics | null {
  const nameMatch = block.match(/^=== (.+?) ===/m);
  if (!nameMatch) return null;

  const name = nameMatch[1];

  const availableMatch = block.match(/Tools available: (.+)/);
  const calledMatch = block.match(/Tools called: (.+)/);
  const costMatch = block.match(/Cost: \$([0-9.]+)/);
  const tokensMatch = block.match(/Tokens: (\d+) \(in: (\d+), out: (\d+)\)/);
  const turnsMatch = block.match(/Turns: (\d+)/);
  const successMatch = block.match(/Success: (true|false)/);

  const toolsAvailable = availableMatch
    ? availableMatch[1].split(', ').map(t => t.trim()).filter(Boolean)
    : [];

  const toolsCalled = calledMatch
    ? calledMatch[1].split(', ').map(t => t.trim()).filter(Boolean)
    : [];

  return {
    name,
    toolsAvailable,
    toolsCalled,
    cost: costMatch ? parseFloat(costMatch[1]) : 0,
    tokens: tokensMatch
      ? { total: parseInt(tokensMatch[1]), input: parseInt(tokensMatch[2]), output: parseInt(tokensMatch[3]) }
      : { total: 0, input: 0, output: 0 },
    turns: turnsMatch ? parseInt(turnsMatch[1]) : 0,
    success: successMatch ? successMatch[1] === 'true' : false,
  };
}

/**
 * Parse all scenario blocks from eval output.
 */
function parseEvalOutput(output: string): ScenarioMetrics[] {
  const scenarios: ScenarioMetrics[] = [];

  // Split on scenario headers (=== ... ===)
  const blocks = output.split(/(?=^=== .+ ===)/m);

  for (const block of blocks) {
    const scenario = parseScenarioBlock(block);
    if (scenario) {
      scenarios.push(scenario);
    }
  }

  return scenarios;
}

/**
 * Count tool call frequency across all scenarios.
 */
function analyzeToolFrequency(scenarios: ScenarioMetrics[]): ToolFrequency[] {
  const freq = new Map<string, { count: number; scenarios: Set<string> }>();

  for (const scenario of scenarios) {
    for (const tool of scenario.toolsCalled) {
      const existing = freq.get(tool) ?? { count: 0, scenarios: new Set() };
      existing.count++;
      existing.scenarios.add(scenario.name);
      freq.set(tool, existing);
    }
  }

  return Array.from(freq.entries())
    .map(([tool, data]) => ({
      tool,
      count: data.count,
      scenarios: Array.from(data.scenarios),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Detect repeated tool calls within a single scenario.
 */
function detectRepeatedCalls(scenarios: ScenarioMetrics[]): Array<{ scenario: string; tool: string; count: number }> {
  const repeated: Array<{ scenario: string; tool: string; count: number }> = [];

  for (const scenario of scenarios) {
    const callCounts = new Map<string, number>();
    for (const tool of scenario.toolsCalled) {
      callCounts.set(tool, (callCounts.get(tool) ?? 0) + 1);
    }

    for (const [tool, count] of callCounts) {
      if (count >= 3) {
        repeated.push({ scenario: scenario.name, tool, count });
      }
    }
  }

  return repeated.sort((a, b) => b.count - a.count);
}

/**
 * Identify improvement candidates based on trace patterns.
 */
function identifyImprovements(scenarios: ScenarioMetrics[]): ImprovementCandidate[] {
  const candidates: ImprovementCandidate[] = [];

  for (const scenario of scenarios) {
    // Failed scenarios
    if (!scenario.success) {
      candidates.push({
        scenario: scenario.name,
        signal: 'FAILURE',
        detail: 'Scenario did not complete successfully — investigate verbose trace for root cause',
      });
    }

    // High turns for few unique tools
    const uniqueTools = new Set(scenario.toolsCalled).size;
    if (scenario.turns > 5 && uniqueTools <= 2) {
      candidates.push({
        scenario: scenario.name,
        signal: 'HIGH_TURNS',
        detail: `${scenario.turns} turns but only ${uniqueTools} unique tool(s) — LLM may be struggling with tool descriptions or responses`,
      });
    }

    // High cost
    if (scenario.cost > 0.10) {
      candidates.push({
        scenario: scenario.name,
        signal: 'HIGH_COST',
        detail: `$${scenario.cost.toFixed(4)} — consider trimming response schemas or reducing available tools`,
      });
    }

    // Many tools available but few called
    if (scenario.toolsAvailable.length > 10 && uniqueTools <= 2) {
      candidates.push({
        scenario: scenario.name,
        signal: 'TOOL_BLOAT',
        detail: `${scenario.toolsAvailable.length} tools available but only ${uniqueTools} used — consider using slices/modes to reduce tool exposure`,
      });
    }

    // Repeated calls to same tool
    const callCounts = new Map<string, number>();
    for (const tool of scenario.toolsCalled) {
      callCounts.set(tool, (callCounts.get(tool) ?? 0) + 1);
    }
    for (const [tool, count] of callCounts) {
      if (count >= 3) {
        candidates.push({
          scenario: scenario.name,
          signal: 'REPEATED_CALLS',
          detail: `${tool} called ${count} times — may indicate retry loop, pagination confusion, or unclear response`,
        });
      }
    }
  }

  return candidates;
}

/**
 * Format the analysis report.
 */
function formatReport(
  scenarios: ScenarioMetrics[],
  toolFrequency: ToolFrequency[],
  repeatedCalls: Array<{ scenario: string; tool: string; count: number }>,
  improvements: ImprovementCandidate[]
): string {
  const lines: string[] = [];

  // Summary
  lines.push('Eval Trace Analysis');
  lines.push('='.repeat(70));
  lines.push('');

  const totalCost = scenarios.reduce((sum, s) => sum + s.cost, 0);
  const totalTokens = scenarios.reduce((sum, s) => sum + s.tokens.total, 0);
  const avgTurns = scenarios.length > 0
    ? (scenarios.reduce((sum, s) => sum + s.turns, 0) / scenarios.length).toFixed(1)
    : '0';
  const successRate = scenarios.length > 0
    ? Math.round(scenarios.filter(s => s.success).length / scenarios.length * 100)
    : 0;

  lines.push(`Scenarios:    ${scenarios.length}`);
  lines.push(`Success rate: ${successRate}%`);
  lines.push(`Total cost:   $${totalCost.toFixed(4)}`);
  lines.push(`Total tokens: ${totalTokens.toLocaleString()}`);
  lines.push(`Avg turns:    ${avgTurns}`);
  lines.push('');

  // Per-scenario metrics
  lines.push('Per-Scenario Metrics:');
  lines.push('-'.repeat(70));

  const nameW = 35;
  const header = `${'Scenario'.padEnd(nameW)} | Turns | Cost     | Tokens  | OK`;
  lines.push(header);
  lines.push('-'.repeat(70));

  for (const s of scenarios) {
    const name = s.name.length > nameW - 1 ? s.name.substring(0, nameW - 2) + '..' : s.name.padEnd(nameW);
    const turns = s.turns.toString().padStart(5);
    const cost = `$${s.cost.toFixed(4)}`.padStart(8);
    const tokens = s.tokens.total.toLocaleString().padStart(7);
    const ok = s.success ? 'yes' : ' NO';
    lines.push(`${name} | ${turns} | ${cost} | ${tokens} | ${ok}`);
  }
  lines.push('');

  // Tool frequency
  if (toolFrequency.length > 0) {
    lines.push('Tool Usage Frequency:');
    lines.push('-'.repeat(70));
    for (const tf of toolFrequency.slice(0, 15)) {
      lines.push(`  ${tf.tool.padEnd(40)} ${tf.count.toString().padStart(3)}x  (${tf.scenarios.length} scenario${tf.scenarios.length !== 1 ? 's' : ''})`);
    }
    if (toolFrequency.length > 15) {
      lines.push(`  ... and ${toolFrequency.length - 15} more tools`);
    }
    lines.push('');
  }

  // Repeated calls
  if (repeatedCalls.length > 0) {
    lines.push('Repeated Tool Calls (3+ in a single scenario):');
    lines.push('-'.repeat(70));
    for (const rc of repeatedCalls) {
      lines.push(`  ${rc.scenario}: ${rc.tool} x${rc.count}`);
    }
    lines.push('');
  }

  // Improvement candidates
  if (improvements.length > 0) {
    lines.push('Improvement Candidates:');
    lines.push('-'.repeat(70));
    for (const ic of improvements) {
      lines.push(`  [${ic.signal}] ${ic.scenario}`);
      lines.push(`    ${ic.detail}`);
    }
    lines.push('');
  }

  if (improvements.length === 0 && repeatedCalls.length === 0) {
    lines.push('No obvious improvement candidates detected.');
    lines.push('');
  }

  lines.push('='.repeat(70));
  lines.push('Run with E2E_VERBOSITY=verbose for full conversation traces.');

  return lines.join('\n');
}

/**
 * Main function
 */
async function main() {
  const projectRoot = path.resolve(process.env.PROJECT_ROOT || '.');
  const collection = process.env.COLLECTION;
  const logFile = process.env.LOG_FILE;

  let output: string;

  if (logFile) {
    // Read from provided log file
    const logPath = path.resolve(logFile);
    if (!fs.existsSync(logPath)) {
      console.error(`Log file not found: ${logPath}`);
      process.exit(1);
    }
    output = fs.readFileSync(logPath, 'utf-8');
  } else {
    // Run evals and capture output
    const testCmd = collection
      ? `npm run test:evals -- --testPathPattern="${collection}" 2>&1`
      : 'npm run test:evals 2>&1';

    console.log(`Running: ${testCmd}`);
    console.log(`Working directory: ${projectRoot}`);
    console.log('');

    try {
      output = execSync(testCmd, {
        cwd: projectRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 300000, // 5 minutes
      });
    } catch (error: unknown) {
      // execSync throws on non-zero exit, but we still want the output
      const execError = error as { stdout?: string; stderr?: string };
      output = (execError.stdout || '') + (execError.stderr || '');
      if (!output) {
        console.error('Failed to run evals and no output captured.');
        process.exit(1);
      }
    }
  }

  // Parse scenarios from output
  const scenarios = parseEvalOutput(output);

  if (scenarios.length === 0) {
    console.log('No scenario results found in output.');
    console.log('Expected format from logTestResult():');
    console.log('  === Test Name ===');
    console.log('  Tools available: ...');
    console.log('  Tools called: ...');
    console.log('  Cost: $0.0123');
    console.log('  Tokens: 1234 (in: 1000, out: 234)');
    console.log('  Turns: 3');
    console.log('  Success: true');
    console.log('');
    console.log('Ensure your eval tests call logTestResult() or use runScenarioTest().');
    process.exit(0);
  }

  // Analyze
  const toolFrequency = analyzeToolFrequency(scenarios);
  const repeatedCalls = detectRepeatedCalls(scenarios);
  const improvements = identifyImprovements(scenarios);

  // Report
  const report = formatReport(scenarios, toolFrequency, repeatedCalls, improvements);
  console.log(report);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
