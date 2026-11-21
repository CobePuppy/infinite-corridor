$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$guide = '.agents/skills/game-dev-guide'
$problems = [System.Collections.Generic.List[string]]::new()

foreach ($directory in @('docs', 'src', 'assets', 'memory', 'trash', 'scripts', "$guide/references")) {
    if (-not (Test-Path -LiteralPath (Join-Path $workspace $directory) -PathType Container)) {
        $problems.Add("Missing directory: $directory")
    }
}

$guideReferences = @(
    'build-from-docs.md'
    'design-package.md'
    'dialogue-and-playtest.md'
    'external-tools.md'
    'github.md'
    'stages.md'
)
$markdownFiles = @(
    'AGENTS.md'
    'docs/game_design_doc.md'
    'docs/codex_workflow_instructions.md'
    "$guide/SKILL.md"
) + @($guideReferences | ForEach-Object { "$guide/references/$_" })
$requiredFiles = $markdownFiles + @('.gitignore', "$guide/agents/openai.yaml")
foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $workspace $file) -PathType Leaf)) {
        $problems.Add("Missing file: $file")
    }
}

$workspacePrefix = [System.IO.Path]::GetFullPath($workspace).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
foreach ($file in $markdownFiles) {
    $path = Join-Path $workspace $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        continue
    }

    $markdown = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    foreach ($link in [regex]::Matches($markdown, '\[[^\]\r\n]+\]\((?<target>[^\s)]+)\)')) {
        $target = $link.Groups['target'].Value
        if ($target -match '^(#|[a-z][a-z0-9+.-]*:|//)') {
            continue
        }

        $relativePath = [uri]::UnescapeDataString(($target -split '#', 2)[0])
        $destination = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $path) $relativePath))
        if (-not $destination.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $destination)) {
            $problems.Add("$file -> $target")
        }
    }
}

if ($problems.Count -gt 0) {
    $problems | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    exit 1
}

Write-Host "Workspace check passed ($($requiredFiles.Count) required files)."
