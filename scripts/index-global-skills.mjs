#!/usr/bin/env node
/**
 * scripts/index-global-skills.mjs
 *
 * Indexes global OpenCode skills from ~/.config/opencode/skills/
 * into the Cave Meister RAG brain for automatic context retrieval.
 *
 * Usage:
 *   node scripts/index-global-skills.mjs [options]
 *
 * Options:
 *   --reset    Drop and rebuild the skills index from scratch
 *   --dir <p>  Directory to search for skills (default: ~/.config/opencode/skills)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join, basename } from "node:path"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    reset: { type: "boolean", default: false },
    dir: { type: "string" },
  },
  strict: false,
})

const TABLE_NAME = "cave-meister-global-skills"
const SKILLS_DIR = args.dir ?? join(homedir(), ".config", "opencode", "skills")
const BRAIN_API_URL = process.env.CAVE_MEISTER_BRAIN_URL ?? "https://cave-meister-204-168-194-125.traefik.me"
const BRAIN_TOKEN = process.env.CAVE_MEISTER_PROJECT_BRAIN_TOKEN

// Skills to index (excluding minimax-maximizer per user request)
const ENABLED_SKILLS = [
  "centralized-logging",
  "docker-first-local-env", 
  "evidence-learning",
  "context-anchor",
  "diagnose",
  "triage",
  "verified-architecture-planning",
]

function nowIso() {
  return new Date().toISOString()
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  
  const lines = match[1].split("\n")
  const frontmatter = {}
  let currentKey = null
  
  for (const line of lines) {
    const keyMatch = line.match(/^(\w+):\s*(.*)$/)
    if (keyMatch) {
      currentKey = keyMatch[1]
      const value = keyMatch[2].trim()
      frontmatter[currentKey] = value.startsWith('"') && value.endsWith('"') 
        ? value.slice(1, -1) 
        : value
    }
  }
  
  return { frontmatter, body: match[2] }
}

function skillToChunks(skillDir) {
  const skillName = basename(skillDir)
  const skillMdPath = join(skillDir, "SKILL.md")
  
  if (!existsSync(skillMdPath)) {
    console.warn(`  [warn] No SKILL.md found in ${skillDir}`)
    return []
  }
  
  const content = readFileSync(skillMdPath, "utf8")
  const { frontmatter, body } = parseFrontmatter(content)
  
  const chunks = []
  
  // Chunk 1: Skill metadata and description
  chunks.push({
    doc_id: `${skillName}:metadata`,
    doc_type: "skill_metadata",
    skill_name: skillName,
    chunk_index: 0,
    chunk_total: 3,
    created_at: nowIso(),
    updated_at: nowIso(),
    text: [
      `Skill: ${skillName}`,
      `Description: ${frontmatter.description ?? "No description"}`,
      `Domain: ${frontmatter.metadata?.domain ?? "general"}`,
      `Applies to: ${frontmatter.metadata?.["applies-to"] ?? "all tasks"}`,
      `License: ${frontmatter.license ?? "unknown"}`,
      `Compatibility: ${frontmatter.compatibility ?? "universal"}`,
    ].join("\n"),
    metadata: {
      skill_name: skillName,
      domain: frontmatter.metadata?.domain ?? "general",
      applies_to: frontmatter.metadata?.["applies-to"] ?? "all tasks",
      license: frontmatter.license,
      compatibility: frontmatter.compatibility,
    }
  })
  
  // Chunk 2: Hard rules and policies
  const rulesMatch = body.match(/## Hard rules([\s\S]*?)(?=## |\Z)/)
  if (rulesMatch) {
    chunks.push({
      doc_id: `${skillName}:rules`,
      doc_type: "skill_rules",
      skill_name: skillName,
      chunk_index: 1,
      chunk_total: 3,
      created_at: nowIso(),
      updated_at: nowIso(),
      text: rulesMatch[1].trim(),
      metadata: {
        skill_name: skillName,
        section: "hard_rules",
      }
    })
  }
  
  // Chunk 3: Key workflows and procedures
  const workflowMatches = body.match(/## .*workflow[\s\S]*?(?=## |\Z)/gi)
  if (workflowMatches) {
    chunks.push({
      doc_id: `${skillName}:workflows`,
      doc_type: "skill_workflows",
      skill_name: skillName,
      chunk_index: 2,
      chunk_total: 3,
      created_at: nowIso(),
      updated_at: nowIso(),
      text: workflowMatches.join("\n\n").trim(),
      metadata: {
        skill_name: skillName,
        section: "workflows",
      }
    })
  }
  
  return chunks
}

async function upsertToBrain(chunks) {
  if (!BRAIN_TOKEN) {
    console.error("ERROR: CAVE_MEISTER_PROJECT_BRAIN_TOKEN is not set")
    console.error("       Set it to enable skill indexing to the RAG brain")
    return false
  }
  
  try {
    const response = await fetch(`${BRAIN_API_URL}/skills/bulk-index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BRAIN_TOKEN}`,
      },
      body: JSON.stringify({
        table: TABLE_NAME,
        items: chunks,
      }),
    })
    
    if (!response.ok) {
      console.error(`  [error] Brain API returned ${response.status}: ${await response.text()}`)
      return false
    }
    
    return true
  } catch (err) {
    console.error(`  [error] Failed to upsert to brain: ${err.message}`)
    return false
  }
}

async function main() {
  console.log("Cave Meister Global Skills Indexer")
  console.log("===================================")
  console.log(`Skills directory: ${SKILLS_DIR}`)
  console.log(`Brain API: ${BRAIN_API_URL}`)
  console.log("")
  
  if (!existsSync(SKILLS_DIR)) {
    console.error(`ERROR: Skills directory not found: ${SKILLS_DIR}`)
    process.exit(1)
  }
  
  const allChunks = []
  const indexedSkills = []
  const skippedSkills = []
  
  for (const skillName of ENABLED_SKILLS) {
    const skillDir = join(SKILLS_DIR, skillName)
    
    if (!existsSync(skillDir)) {
      console.log(`  [skip] Skill not found: ${skillName}`)
      skippedSkills.push(skillName)
      continue
    }
    
    console.log(`  [indexing] ${skillName}...`)
    const chunks = skillToChunks(skillDir)
    
    if (chunks.length > 0) {
      allChunks.push(...chunks)
      indexedSkills.push(skillName)
      console.log(`             → ${chunks.length} chunks`)
    } else {
      skippedSkills.push(skillName)
    }
  }
  
  console.log("")
  console.log(`Indexed ${indexedSkills.length} skills, ${skippedSkills.length} skipped`)
  console.log(`Total chunks: ${allChunks.length}`)
  
  if (allChunks.length === 0) {
    console.log("No chunks to index. Exiting.")
    process.exit(0)
  }
  
  // Upsert to brain
  console.log("")
  console.log("Upserting to RAG brain...")
  const success = await upsertToBrain(allChunks)
  
  if (success) {
    console.log("✓ Successfully indexed global skills to RAG brain")
    console.log("")
    console.log("These skills will now be available for automatic context retrieval")
    console.log("when agents use project_brain_search with relevant queries.")
  } else {
    console.error("✗ Failed to index skills to RAG brain")
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
