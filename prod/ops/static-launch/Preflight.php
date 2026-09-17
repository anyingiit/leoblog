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
        $mKeys=array_keys($m);sort($mKeys);
        if ($mKeys!==['articles','build_utc','content_sha','dirty_sha256','git_sha','provenance','version'] || ($m['version']??null)!==2 ||
            ($m['provenance']??null)!=='owner-static' || ($m['git_sha']??null)!==$r['git_sha'] || ($m['dirty_sha256']??null)!==$r['dirty_sha256'] ||
            ($m['build_utc']??null)!==$r['build_utc'] || ($m['content_sha']??null)!==$r['content_sha256']) Operator::fail();
        if ($i!==['version'=>1,'generation'=>$r['generation'],'content_sha'=>$r['content_sha256'],'approval_manifest_hash'=>$r['input_manifest_sha256']]) {
            $want=['version'=>1,'generation'=>$r['generation'],'content_sha'=>$r['content_sha256'],'approval_manifest_hash'=>$r['input_manifest_sha256']];
            if (Operator::json($i)!==Operator::json($want)) Operator::fail();
        }
        if (hash_file('sha256',$r['input_dir'].'/public.json')!==$r['content_sha256'] || hash_file('sha256',$r['input_dir'].'/manifest.json')!==$r['input_manifest_sha256']) Operator::fail();
        if (($p['version']??null)!==1 || ($p['git_sha']??null)!==$r['git_sha'] || ($p['media']??null)!==[] || ($p['approved']??null)!==[] || ($p['timeline']['events']??null)!==[]) Operator::fail();
        $posts=$p['posts']??null;
        if (!is_array($posts) || !array_is_list($posts) || count($posts)<1 || count($posts)>32) Operator::fail();
        $slugRe='/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/';
        $titleBanned='/[<>&"\'`\x00-\x1f\x7f]/';
        $approvalRe='~\Adocs/decisions/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md#approved-public-text-verbatim\z~';
        $seenSlugs=[];
        foreach ($posts as $post) {
            if (!is_array($post)) Operator::fail();
            $keys=array_keys($post);sort($keys);
            if ($keys!==['body','published_at','sha','slug','summary','tags','title']) Operator::fail();
            $slug=$post['slug']??null; $title=$post['title']??null;
            if (!is_string($slug) || strlen($slug)>64 || !preg_match($slugRe,$slug) || isset($seenSlugs[$slug])) Operator::fail();
            $seenSlugs[$slug]=true;
            if (!is_string($title) || !mb_check_encoding($title,'UTF-8') || mb_strlen($title,'UTF-8')<1 || mb_strlen($title,'UTF-8')>80 ||
                preg_match('/\A\s|\s\z/u',$title) || preg_match($titleBanned,$title)) Operator::fail();
            if (($post['summary']??null)!=='' || ($post['tags']??null)!==[] || ($post['published_at']??null)!==$r['build_utc'] ||
                ($post['sha']??null)!==hash('sha256',$post['body']??'')) Operator::fail();
        }
        $articles=$m['articles']??null;
        if (!is_array($articles) || !array_is_list($articles) || count($articles)!==count($posts)) Operator::fail();
        foreach ($articles as $idx=>$article) {
            if (!is_array($article)) Operator::fail();
            $keys=array_keys($article);sort($keys);
            if ($keys!==['approval_reference','body_sha256','slug']) Operator::fail();
            if (($article['slug']??null)!==$posts[$idx]['slug'] || ($article['body_sha256']??null)!==$posts[$idx]['sha'] ||
                !is_string($article['approval_reference']??null) || !preg_match($approvalRe,$article['approval_reference'])) Operator::fail();
        }
        $s=@lstat($r['artifact_path']); if (!$s || ($s['mode']&0170000)!==0100000 || $s['size']!==$r['artifact_size']) Operator::fail();
        (new TarGzArtifactVerifier($r['artifact_root'],$r['temp_root']))->withExtractedDirectory($r['artifact_path'],$r['artifact_hash'],function(string $root) use($r,$posts): void {
            $files=[]; $it=new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root,\FilesystemIterator::SKIP_DOTS));
            foreach($it as $f) { if(!$f->isFile() || $f->isLink()) Operator::fail(); $files[]=substr($f->getPathname(),strlen($root)+1); }
            sort($files);
            $expectedFiles=['404.html','index.html','manifest.json','robots.txt','sitemap.xml'];
            foreach ($posts as $post) $expectedFiles[]='posts/'.$post['slug'].'/index.html';
            sort($expectedFiles);
            if($files!==$expectedFiles) Operator::fail();
            if(hash_file('sha256',$root.'/index.html')!==$r['index_sha256']) Operator::fail();
            $manifest=Operator::read($root.'/manifest.json');
            $routes=['/'];
            foreach ($posts as $post) $routes[]='/posts/'.$post['slug'];
            sort($routes,SORT_STRING);
            if (($manifest['version']??null)!==1 || ($manifest['routes']??null)!==$routes || count($manifest['files']??[])!==count($posts)+4) Operator::fail();
            $members=array_values(array_diff($expectedFiles,['manifest.json']));
            $seen=[];
            foreach($manifest['files'] as $file) {
                $name=ltrim($file['path']??'','/');
                if(!in_array($name,$members,true) || isset($seen[$name])) Operator::fail();
                $seen[$name]=true; $bytes=file_get_contents($root.'/'.$name);
                if(($file['size']??null)!==strlen($bytes) || ($file['sha256']??null)!==hash('sha256',$bytes)) Operator::fail();
                if(str_ends_with($name,'.html')) {
                    if(substr_count(strtolower($bytes),'leoblog-version')!==1 || substr_count($bytes,'<meta name="leoblog-version" content="'.$r['marker'].'"')!==1) Operator::fail();
                    if(preg_match('~<(?:script|form|iframe|object|embed|base)\b~i',$bytes)) Operator::fail();
                }
            }
            $origin='https://douseful.eu.org';
            $home=file_get_contents($root.'/index.html');
            $canonicalCount=static fn(string $bytes): int => preg_match_all("~<link\\b(?=[^>]*\\brel\\s*=\\s*(?:\"[^\"]*\\bcanonical\\b[^\"]*\"|'[^']*\\bcanonical\\b[^']*'|canonical(?:\\s|/?>)))[^>]*>~i",$bytes);
            if($canonicalCount($home)!==1 || substr_count($home,'<link rel="canonical" href="'.$origin.'/"')!==1 || stripos($home,'noindex')!==false) Operator::fail();
            $lastPos=-1;
            foreach (array_reverse($posts) as $post) {
                $slug=$post['slug'];$title=$post['title'];
                if (substr_count($home,'href="/posts/'.$slug.'"')!==1 || substr_count($home,'<a href="/posts/'.$slug.'">'.$title.'</a>')!==1) Operator::fail();
                $pos=strpos($home,'<a href="/posts/'.$slug.'">'.$title.'</a>');
                if ($pos===false || $pos<=$lastPos) Operator::fail();
                $lastPos=$pos;
            }
            foreach ($posts as $post) {
                $slug=$post['slug'];$title=$post['title'];
                $article=file_get_contents($root.'/posts/'.$slug.'/index.html');
                if($canonicalCount($article)!==1 || substr_count($article,'<link rel="canonical" href="'.$origin.'/posts/'.$slug.'"')!==1 || stripos($article,'noindex')!==false) Operator::fail();
                if(substr_count($article,'<h1>'.$title.'</h1>')!==1) Operator::fail();
            }
            $missing=file_get_contents($root.'/404.html');
            if($canonicalCount($missing)!==0 || substr_count($missing,'<meta name="robots" content="noindex, nofollow"')!==1) Operator::fail();
            $sitemap='<?xml version="1.0" encoding="UTF-8"?>'."\n".'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
            foreach ($routes as $route) $sitemap.='<url><loc>'.$origin.$route.'</loc></url>';
            $sitemap.='</urlset>'."\n";
            $robots="User-agent: *\nAllow: /\nSitemap: {$origin}/sitemap.xml\n";
            if(file_get_contents($root.'/sitemap.xml')!==$sitemap || file_get_contents($root.'/robots.txt')!==$robots) Operator::fail();
        });
    }
}
