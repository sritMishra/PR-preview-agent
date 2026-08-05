// Standalone STRUCTURE check — NOT part of the running server.
//
// Run it with:  npx tsx src/graph/verify-graph.ts   (from packages/server/)
//
// Makes NO network calls and posts NOTHING. It only proves two things:
// the graph compiled, and its edges are the ones we intended.
import { reviewGraph } from './graph.js';

// Every compiled LangGraph can describe its own topology. drawMermaid() renders
// that as Mermaid text — the same diagram syntax GitHub renders in markdown.
const drawable = await reviewGraph.getGraphAsync({});

console.log(drawable.drawMermaid());
