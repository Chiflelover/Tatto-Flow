-- Add explicit client choices without rewriting historical declarations.
ALTER TYPE "color_declaration" ADD VALUE 'LOW_COLOR';
ALTER TYPE "color_declaration" ADD VALUE 'MEDIUM_COLOR';
ALTER TYPE "color_declaration" ADD VALUE 'FULL_COLOR';
