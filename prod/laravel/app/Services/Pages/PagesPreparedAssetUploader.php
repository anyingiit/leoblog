<?php
namespace App\Services\Pages;
final class PagesPreparedAssetUploader
{
    public function __construct(private TarGzArtifactVerifier $verifier, private PagesAssetHasher $hasher, private PagesAssetUploader $uploader) { PagesWorkerBudget::assertValid(); }
    public function upload(string $artifactPath, string $artifactHash, string $versionMarker): array
    {
        PagesWorkerBudget::assertValid();
        if (!preg_match('/\A[0-9a-f]{64}\z/', $versionMarker)) $this->invalid();
        return $this->verifier->withExtractedDirectory($artifactPath, $artifactHash, function (string $root) use ($versionMarker): array {
            $paths = [];
            $walk = function (string $directory, string $prefix = '') use (&$walk, &$paths): void {
                $names = scandir($directory); if ($names === false) $this->invalid();
                foreach ($names as $name) {
                    if ($name === '.' || $name === '..') continue;
                    $relative = $prefix.$name; $full = $directory.'/'.$name;
                    if (in_array($name, ['.git', 'node_modules', '.DS_Store'], true) || ($prefix === '' && in_array($name, ['_headers', '_redirects', '_worker.js', '_routes.json', 'functions', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc'], true))) $this->invalid();
                    if (strlen('/'.$relative) > 512 || !preg_match('//u', $relative) || preg_match('/[\x00-\x1f\x7f-\x9f]/u', $relative) || str_contains($relative, '\\')) $this->invalid();
                    $stat = lstat($full); if ($stat === false) $this->invalid();
                    if (($stat['mode'] & 0170000) === 0040000) $walk($full, $relative.'/');
                    elseif (($stat['mode'] & 0170000) === 0100000) { $paths[$relative] = $full; if (count($paths) > 20000) $this->invalid(); }
                    else $this->invalid();
                }
            };
            $walk($root); ksort($paths, SORT_STRING);
            $files = []; $total = 0; $index = null;
            foreach ($paths as $relative => $full) {
                // Capture once: identical bytes feed the helper and uploader.
                $bytes = file_get_contents($full, false, null, 0, 25 * 1024 * 1024 + 1);
                if ($bytes === false || strlen($bytes) > 25 * 1024 * 1024) $this->invalid();
                $total += strlen($bytes); if ($total > 64 * 1024 * 1024) $this->invalid();
                if ($relative === 'index.html') $index = $bytes;
                $files[] = ['path'=>$relative,'content'=>base64_encode($bytes),'size'=>strlen($bytes),'contentType'=>$this->mime($relative)];
            }
            if ($index === null || substr_count(strtolower($index), 'leoblog-version') !== 1 || substr_count($index, '<meta name="leoblog-version" content="'.$versionMarker.'"') !== 1) $this->invalid();
            $assets = []; $batch = []; $size = 0;
            $flush = function () use (&$batch, &$size, &$assets): void {
                if (!$batch) return;
                $hashes = $this->hasher->hash(array_map(fn ($f) => ['path'=>$f['path'],'content'=>$f['content']], $batch));
                if (!array_is_list($hashes) || count($hashes) !== count($batch)) $this->invalid();
                foreach ($batch as $i => $file) {
                    if (($hashes[$i]['path'] ?? null) !== $file['path'] || !is_string($hashes[$i]['hash'] ?? null) || !preg_match('/\A[0-9a-f]{32}\z/', $hashes[$i]['hash'])) $this->invalid();
                    unset($file['size']); $assets[] = $file + ['hash'=>$hashes[$i]['hash']];
                }
                $batch = []; $size = 0;
            };
            foreach ($files as $file) {
                if ($batch && (count($batch) === 1000 || $size + $file['size'] > 25 * 1024 * 1024)) $flush();
                $batch[] = $file; $size += $file['size'];
            }
            $flush(); return $this->uploader->upload($assets);
        });
    }
    private function mime(string $path): string
    {
        return match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'html'=>'text/html','css'=>'text/css','js'=>'application/javascript','json'=>'application/json','xml'=>'application/xml','svg'=>'image/svg+xml','png'=>'image/png','jpg','jpeg'=>'image/jpeg','webp'=>'image/webp','ico'=>'image/x-icon','woff2'=>'font/woff2','txt'=>'text/plain',default=>'application/octet-stream',
        };
    }
    private function invalid(): never { throw new \RuntimeException('pages_artifact_invalid'); }
}
