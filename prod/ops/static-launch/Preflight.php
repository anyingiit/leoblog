<?php
declare(strict_types=1);
namespace Leoblog\StaticLaunch;
use App\Services\Pages\TarGzArtifactVerifier;
final class Preflight
{
    public static function check(array $r): void
    {
        Operator::validate($r);
        $names=scandir($r['input_dir']);
        if ($names!==['.','..','manifest.json','public.json','publication-identity.json']) Operator::fail();
        $m=Operator::read($r['input_dir'].'/manifest.json');
        $i=Operator::read($r['input_dir'].'/publication-identity.json');
        $p=Operator::read($r['input_dir'].'/public.json');
        if (($m['provenance']??null)!=='owner-static' || ($m['git_sha']??null)!==$r['git_sha'] || ($m['dirty_sha256']??null)!==$r['dirty_sha256'] ||
            ($m['build_utc']??null)!==$r['build_utc'] || ($m['content_sha']??null)!==$r['content_sha256']) Operator::fail();
        if ($i!==['version'=>1,'generation'=>$r['generation'],'content_sha'=>$r['content_sha256'],'approval_manifest_hash'=>$r['input_manifest_sha256']]) {
            $want=['version'=>1,'generation'=>$r['generation'],'content_sha'=>$r['content_sha256'],'approval_manifest_hash'=>$r['input_manifest_sha256']];
            if (Operator::json($i)!==Operator::json($want)) Operator::fail();
        }
        if (hash_file('sha256',$r['input_dir'].'/public.json')!==$r['content_sha256'] || hash_file('sha256',$r['input_dir'].'/manifest.json')!==$r['input_manifest_sha256']) Operator::fail();
        if (($p['git_sha']??null)!==$r['git_sha'] || count($p['posts']??[])!==1 || ($p['posts'][0]['slug']??null)!=='hello-world' ||
            ($p['posts'][0]['title']??null)!=='博客上线了' || ($p['media']??null)!==[] || ($p['approved']??null)!==[] || ($p['timeline']['events']??null)!==[]) Operator::fail();
        if (($m['body_sha256']??null)!==hash('sha256',$p['posts'][0]['body']??'')) Operator::fail();
        $s=@lstat($r['artifact_path']); if (!$s || ($s['mode']&0170000)!==0100000 || $s['size']!==$r['artifact_size']) Operator::fail();
        (new TarGzArtifactVerifier($r['artifact_root'],$r['temp_root']))->withExtractedDirectory($r['artifact_path'],$r['artifact_hash'],function(string $root) use($r): void {
            $files=[]; $it=new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root,\FilesystemIterator::SKIP_DOTS));
            foreach($it as $f) { if(!$f->isFile() || $f->isLink()) Operator::fail(); $files[]=substr($f->getPathname(),strlen($root)+1); }
            sort($files); if($files!==['404.html','index.html','manifest.json','posts/hello-world/index.html','robots.txt','sitemap.xml']) Operator::fail();
            if(hash_file('sha256',$root.'/index.html')!==$r['index_sha256']) Operator::fail();
            $manifest=Operator::read($root.'/manifest.json');
            if(($manifest['version']??null)!==1 || ($manifest['routes']??null)!==['/','/posts/hello-world'] || count($manifest['files']??[])!==5) Operator::fail();
            $seen=[];
            foreach($manifest['files'] as $file) {
                $name=ltrim($file['path']??'','/');
                if(!in_array($name,['404.html','index.html','posts/hello-world/index.html','robots.txt','sitemap.xml'],true) || isset($seen[$name])) Operator::fail();
                $seen[$name]=true; $bytes=file_get_contents($root.'/'.$name);
                if(($file['size']??null)!==strlen($bytes) || ($file['sha256']??null)!==hash('sha256',$bytes)) Operator::fail();
                if(str_ends_with($name,'.html')) {
                    if(substr_count(strtolower($bytes),'leoblog-version')!==1 || substr_count($bytes,'<meta name="leoblog-version" content="'.$r['marker'].'"')!==1) Operator::fail();
                    if(preg_match('~<(?:script|form|iframe|object|embed|base)\b~i',$bytes)) Operator::fail();
                }
            }
            $origin='https://douseful.eu.org';
            $home=file_get_contents($root.'/index.html');$article=file_get_contents($root.'/posts/hello-world/index.html');$missing=file_get_contents($root.'/404.html');
            $canonicalCount=static fn(string $bytes): int => preg_match_all("~<link\\b(?=[^>]*\\brel\\s*=\\s*(?:\"[^\"]*\\bcanonical\\b[^\"]*\"|'[^']*\\bcanonical\\b[^']*'|canonical(?:\\s|/?>)))[^>]*>~i",$bytes);
            if($canonicalCount($home)!==1 || substr_count($home,'<link rel="canonical" href="'.$origin.'/"')!==1 || stripos($home,'noindex')!==false) Operator::fail();
            if($canonicalCount($article)!==1 || substr_count($article,'<link rel="canonical" href="'.$origin.'/posts/hello-world"')!==1 || stripos($article,'noindex')!==false) Operator::fail();
            if($canonicalCount($missing)!==0 || substr_count($missing,'<meta name="robots" content="noindex, nofollow"')!==1) Operator::fail();
            $sitemap='<?xml version="1.0" encoding="UTF-8"?>'."\n".'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'.$origin.'/</loc></url><url><loc>'.$origin.'/posts/hello-world</loc></url></urlset>'."\n";
            $robots="User-agent: *\nAllow: /\nSitemap: {$origin}/sitemap.xml\n";
            if(file_get_contents($root.'/sitemap.xml')!==$sitemap || file_get_contents($root.'/robots.txt')!==$robots) Operator::fail();
        });
    }
}
