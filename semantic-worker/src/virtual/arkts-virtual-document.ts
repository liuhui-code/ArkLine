import type { SemanticTextRange } from "../protocol.js"
import { offsetToLineColumn } from "../types/text-position.js"

interface TextRewrite {
  sourceStart: number
  sourceEnd: number
  generatedText: string
}

interface RewriteSegment {
  sourceStart: number
  sourceEnd: number
  generatedStart: number
  generatedEnd: number
}

export interface ArktsVirtualDocument {
  sourceContent: string
  generatedContent: string
  toGeneratedOffset(sourceOffset: number): number
  toSourceOffset(generatedOffset: number): number
  generatedSpanToSourceRange(start: number, length: number): SemanticTextRange
}

export function createArktsVirtualDocument(
  filePath: string,
  sourceContent: string,
): ArktsVirtualDocument {
  const rewrites = filePath.toLowerCase().endsWith(".ets")
    ? collectArktsRewrites(sourceContent)
    : []
  const { generatedContent, segments } = applyRewrites(sourceContent, rewrites)

  const toGeneratedOffset = (offset: number) => mapOffset(
    bounded(offset, sourceContent.length),
    segments,
    "source",
  )
  const toSourceOffset = (offset: number) => mapOffset(
    bounded(offset, generatedContent.length),
    segments,
    "generated",
  )

  return {
    sourceContent,
    generatedContent,
    toGeneratedOffset,
    toSourceOffset,
    generatedSpanToSourceRange(start, length) {
      const sourceStart = toSourceOffset(start)
      const sourceEnd = toSourceOffset(start + length)
      const from = offsetToLineColumn(sourceContent, sourceStart)
      const to = offsetToLineColumn(sourceContent, sourceEnd)
      return {
        startLine: from.line,
        startColumn: from.column,
        endLine: to.line,
        endColumn: to.column,
      }
    },
  }
}

function collectArktsRewrites(content: string): TextRewrite[] {
  return [...content.matchAll(/\bstruct(?=\s+[A-Za-z_$])/g)].map((match) => ({
    sourceStart: match.index,
    sourceEnd: match.index + match[0].length,
    generatedText: "class",
  }))
}

function applyRewrites(source: string, rewrites: TextRewrite[]) {
  let generatedContent = ""
  let sourceCursor = 0
  const segments: RewriteSegment[] = []
  for (const rewrite of rewrites) {
    generatedContent += source.slice(sourceCursor, rewrite.sourceStart)
    const generatedStart = generatedContent.length
    generatedContent += rewrite.generatedText
    segments.push({
      sourceStart: rewrite.sourceStart,
      sourceEnd: rewrite.sourceEnd,
      generatedStart,
      generatedEnd: generatedContent.length,
    })
    sourceCursor = rewrite.sourceEnd
  }
  generatedContent += source.slice(sourceCursor)
  return { generatedContent, segments }
}

function mapOffset(
  offset: number,
  segments: RewriteSegment[],
  direction: "source" | "generated",
): number {
  const segment = lastSegmentStartingBefore(segments, offset, direction)
  if (!segment) return offset
  const start = direction === "source" ? segment.sourceStart : segment.generatedStart
  const end = direction === "source" ? segment.sourceEnd : segment.generatedEnd
  const targetStart = direction === "source" ? segment.generatedStart : segment.sourceStart
  const targetEnd = direction === "source" ? segment.generatedEnd : segment.sourceEnd
  if (offset <= end) {
    if (offset === end) return targetEnd
    return targetStart + Math.min(offset - start, targetEnd - targetStart)
  }
  return offset + targetEnd - end
}

function lastSegmentStartingBefore(
  segments: RewriteSegment[],
  offset: number,
  direction: "source" | "generated",
): RewriteSegment | undefined {
  let low = 0
  let high = segments.length - 1
  let match: RewriteSegment | undefined
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const segment = segments[middle]
    if (!segment) break
    const start = direction === "source" ? segment.sourceStart : segment.generatedStart
    if (start <= offset) {
      match = segment
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return match
}

function bounded(value: number, maximum: number): number {
  return Math.max(0, Math.min(value, maximum))
}
