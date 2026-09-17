<?php
declare(strict_types=1);
namespace Tests\StaticLaunch;
use Leoblog\StaticLaunch\{Operator,Preflight};
use App\Services\Pages\{PagesPreparedAssetUploader,PagesAssetHasher,PagesAssetUploader,TarGzArtifactVerifier};
use Illuminate\Http\Client\Factory;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;
final class PreflightTest extends TestCase
{
    private string $root;
    protected function setUp(): void {
        require_once '/opt/static-launch/Operator.php';require_once '/opt/static-launch/Preflight.php';
        $this->root=sys_get_temp_dir().'/preflight-'.bin2hex(random_bytes(8));mkdir($this->root,0700);
        foreach(['input','artifacts','temp','state'] as $name)mkdir($this->root.'/'.$name,0700);
    }
    protected function tearDown(): void {
        $it=new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->root,\FilesystemIterator::SKIP_DOTS),\RecursiveIteratorIterator::CHILD_FIRST);
        foreach($it as $p)$p->isDir()?rmdir($p->getPathname()):unlink($p->getPathname());rmdir($this->root);
    }
    private function entry(string $name,string $body): string {
        $h=str_repeat("\0",512);
        foreach([0=>$name,100=>"0000644\0",108=>"0000000\0",116=>"0000000\0",124=>sprintf('%011o',strlen($body))."\0",136=>"00000000000\0",148=>'        ',156=>'0',257=>"ustar\00000"] as $offset=>$value)$h=substr_replace($h,$value,$offset,strlen($value));
        $h=substr_replace($h,sprintf('%06o',array_sum(unpack('C*',$h)))."\0 ",148,8);
        return $h.$body.str_repeat("\0",(512-strlen($body)%512)%512);
    }
    /** @return array<int,array{0:string,1:string,2:string}> */
    private function multiArticles(): array {
        return [
            ['hello-world','博客上线了','synthetic test body'],
            ['second-post','第二篇文章','synthetic second body'],
            ['third-post','第三篇文章','synthetic third body'],
        ];
    }
    private function candidate(array $articles=[['hello-world','博客上线了','synthetic test body']], string $fault=''): array {
        $git=str_repeat('f',40);$dirty=str_repeat('0',64);$utc='2026-09-14T10:23:32.000Z';
        $origin='https://douseful.eu.org';
        $approvalRef='docs/decisions/2026-09-14-minimal-static-launch-approval.md#approved-public-text-verbatim';
        $rows=[];
        foreach ($articles as $a) $rows[]=['slug'=>$a[0],'title'=>$a[1],'body'=>$a[2]];
        if ($fault==='too-many-articles') {
            $rows=[];
            for ($n=0;$n<33;$n++) $rows[]=['slug'=>'synthetic-post-'.$n,'title'=>'Synthetic post '.$n,'body'=>'synthetic body '.$n];
        }
        if ($fault==='bad-slug') $rows[0]['slug']='Hello_World';
        if ($fault==='duplicate-slug' && count($rows)>1) $rows[1]['slug']=$rows[0]['slug'];

        $posts=[];
        foreach ($rows as $row) $posts[]=['body'=>$row['body'],'published_at'=>$utc,'sha'=>hash('sha256',$row['body']),'slug'=>$row['slug'],'summary'=>'','tags'=>[],'title'=>$row['title']];
        if ($fault==='published-at') $posts[0]['published_at']='2000-01-01T00:00:00.000Z';
        if ($fault==='post-extra-key') $posts[0]['extra']='unexpected';

        $public=Operator::json(['version'=>1,'git_sha'=>$git,'posts'=>$posts,'media'=>[],'approved'=>[],'timeline'=>['events'=>[]]]);
        $content=hash('sha256',$public);

        $manifestArticles=[];
        foreach ($rows as $idx=>$row) $manifestArticles[]=['slug'=>$row['slug'],'approval_reference'=>$approvalRef,'body_sha256'=>$posts[$idx]['sha']];
        if ($fault==='articles-order' && count($manifestArticles)>1) { $tmp=$manifestArticles[0];$manifestArticles[0]=$manifestArticles[1];$manifestArticles[1]=$tmp; }
        if ($fault==='articles-body-hash') $manifestArticles[0]['body_sha256']=hash('sha256','tampered-body');
        if ($fault==='bad-approval-ref') $manifestArticles[0]['approval_reference']='docs/decisions/not-a-real-approval.md';

        if ($fault==='manifest-v1') {
            $manifest=Operator::json(['provenance'=>'owner-static','git_sha'=>$git,'dirty_sha256'=>$dirty,'build_utc'=>$utc,'content_sha'=>$content,'body_sha256'=>$posts[0]['sha']]);
        } else {
            $manifest=Operator::json(['version'=>2,'provenance'=>'owner-static','git_sha'=>$git,'dirty_sha256'=>$dirty,'build_utc'=>$utc,'content_sha'=>$content,'articles'=>$manifestArticles]);
        }
        $mh=hash('sha256',$manifest);$marker=hash('sha256',"1\n$content\n$mh");
        $identity=Operator::json(['version'=>1,'generation'=>1,'content_sha'=>$content,'approval_manifest_hash'=>$mh]);
        foreach(['public.json'=>$public,'manifest.json'=>$manifest,'publication-identity.json'=>$identity] as $n=>$b)file_put_contents($this->root.'/input/'.$n,$b);

        $home='<meta name="leoblog-version" content="'.$marker.'"><link rel="canonical" href="'.$origin.'/">';
        $order=$fault==='home-link-order'?$rows:array_reverse($rows);
        foreach ($order as $idx=>$row) {
            if ($fault==='home-link-missing' && $idx===0) continue;
            $home.='<a href="/posts/'.$row['slug'].'">'.$row['title'].'</a>';
        }
        if ($fault==='duplicate-canonical') $home.="<LINK REL='canonical' HREF='https://evil.example/'>";

        $pages=[];
        foreach ($rows as $idx=>$row) {
            $title=($fault==='title-mismatch-page' && $idx===0)?$row['title'].'-changed':$row['title'];
            $pages[$row['slug']]='<meta name="leoblog-version" content="'.$marker.'"><link rel="canonical" href="'.$origin.'/posts/'.$row['slug'].'"><h1>'.$title.'</h1>';
        }
        $missing='<meta name="leoblog-version" content="'.$marker.'"><meta name="robots" content="noindex, nofollow"><h1>missing</h1>';

        $routes=['/'];
        foreach ($rows as $row) $routes[]='/posts/'.$row['slug'];
        sort($routes,SORT_STRING);
        $sitemapRoutes=$fault==='sitemap-order'?array_reverse($routes):$routes;
        $sitemap='<?xml version="1.0" encoding="UTF-8"?>'."\n".'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
        foreach ($sitemapRoutes as $route) $sitemap.='<url><loc>'.$origin.$route.'</loc></url>';
        $sitemap.='</urlset>'."\n";
        $robots="User-agent: *\nAllow: /\nSitemap: {$origin}/sitemap.xml\n";

        $members=['index.html'=>$home,'404.html'=>$missing,'robots.txt'=>$robots,'sitemap.xml'=>$sitemap];
        foreach ($rows as $idx=>$row) {
            if ($fault==='missing-article-page' && $idx===count($rows)-1) continue;
            $members['posts/'.$row['slug'].'/index.html']=$pages[$row['slug']];
        }
        $tar='';$filesMeta=[];
        foreach ($members as $name=>$bytes) { $tar.=$this->entry($name,$bytes); $filesMeta[]=['path'=>'/'.$name,'size'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]; }
        if ($fault==='extra-asset') $tar.=$this->entry('unexpected.js','bad');
        if ($fault==='extra-article-page') $tar.=$this->entry('posts/unregistered-post/index.html','<h1>Unregistered</h1>');
        $tar.=$this->entry('manifest.json',Operator::json(['version'=>1,'routes'=>$routes,'files'=>$filesMeta]));
        $archive=gzencode($tar.str_repeat("\0",1024));$path=$this->root.'/artifacts/site.tar.gz';file_put_contents($path,$archive);
        return ['version'=>1,'account_id'=>str_repeat('a',32),'project_id'=>'synthetic-project','project_name'=>'leoblog-prod',
            'artifact_root'=>$this->root.'/artifacts','temp_root'=>$this->root.'/temp','input_dir'=>$this->root.'/input','artifact_path'=>$path,
            'artifact_hash'=>hash('sha256',$archive),'artifact_size'=>strlen($archive),'branch'=>'main','production_branch'=>'main','environment'=>'production',
            'build_utc'=>$utc,'generation'=>1,'git_sha'=>$git,'dirty_sha256'=>$dirty,'content_sha256'=>$content,'input_manifest_sha256'=>$mh,
            'marker'=>$marker,'index_sha256'=>hash('sha256',$home),'origin'=>'https://leoblog-prod.pages.dev/'];
    }
    public function test_preflight_validates_inventory_hashes_and_cleans_extraction(): void {
        $r=$this->candidate();Preflight::check($r);self::assertSame(['.','..'],scandir($r['temp_root']));
        file_put_contents($r['input_dir'].'/public.json','{}');
        $this->expectException(\RuntimeException::class);Preflight::check($r);
    }
    public function test_preflight_rejects_unapproved_extra_asset(): void {
        $r=$this->candidate(fault:'extra-asset');$this->expectException(\RuntimeException::class);Preflight::check($r);
    }
    public function test_preflight_rejects_second_canonical_with_case_and_quote_variants(): void {
        $r=$this->candidate(fault:'duplicate-canonical');
        $this->expectException(\RuntimeException::class);Preflight::check($r);
    }
    public function test_preflight_accepts_multiple_articles(): void {
        $r=$this->candidate($this->multiArticles());
        Preflight::check($r);
        self::assertSame(['.','..'],scandir($r['temp_root']));
    }
    public function test_preflight_rejects_each_article_fault(): void {
        $faults=['extra-article-page','missing-article-page','manifest-v1','articles-order','articles-body-hash','bad-approval-ref',
            'bad-slug','duplicate-slug','title-mismatch-page','home-link-missing','home-link-order','sitemap-order','published-at',
            'post-extra-key','too-many-articles'];
        foreach ($faults as $fault) {
            $r=$this->candidate($this->multiArticles(),$fault);
            try { Preflight::check($r); self::fail($fault); } catch (\RuntimeException $e) { self::assertSame('static_launch_invalid',$e->getMessage(),$fault); }
        }
    }
    public function test_shared_uploader_captures_bytes_without_resolver_and_returns_after_cleanup(): void {
        ini_set('memory_limit','512M');$articles=[['hello-world','博客上线了','synthetic test body']];$r=$this->candidate($articles);$calls=0;
        $hasher=new class implements PagesAssetHasher {
            public array $captured=[];
            public function hash(array $files): array {$this->captured=$files;return array_map(fn($f)=>['path'=>$f['path'],'hash'=>md5(base64_decode($f['content']))],$files);}
        };
        $http=new Factory;$http->preventStrayRequests();
        $http->fake(function()use(&$calls){$calls++;return Create::promiseFor(new Response(200,[],json_encode(match($calls){1=>['success'=>true,'result'=>['jwt'=>'synthetic.jwt']],2=>['success'=>true,'result'=>[]],default=>['success'=>true]})));});
        $uploader=new PagesPreparedAssetUploader(new TarGzArtifactVerifier($r['artifact_root'],$r['temp_root']),$hasher,new PagesAssetUploader($http,$r['account_id'],$r['project_name'],'synthetic-token'));
        $manifest=$uploader->upload($r['artifact_path'],$r['artifact_hash'],$r['marker']);
        self::assertCount(count($articles)+5,$manifest);self::assertCount(count($articles)+5,$hasher->captured);self::assertSame(3,$calls);self::assertSame(['.','..'],scandir($r['temp_root']));
        foreach($hasher->captured as $file)self::assertSame(md5(base64_decode($file['content'])),$manifest['/'.$file['path']]);
    }
    public function test_cli_validate_prepare_need_no_secret_descriptors_or_network(): void {
        $r=$this->candidate();$release=$this->root.'/release.json';file_put_contents($release,Operator::json($r));
        foreach(['validate'=>'validated','prepare'=>'prepared','bogus'=>null] as $mode=>$state){
            $p=proc_open([PHP_BINARY,'/opt/static-launch/publish.php',$mode,$this->root.'/state',$release],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,[]);
            self::assertIsResource($p);fclose($pipes[0]);$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$exit=proc_close($p);
            self::assertSame($state===null?1:0,$exit,$err);
            if($state===null){self::assertSame('', $out);self::assertSame("static_launch_stopped\n",$err);}else{self::assertSame('',$err);self::assertSame($state,json_decode($out,true,flags:JSON_THROW_ON_ERROR)['state']);}
        }
    }
    public function test_synthetic_inherited_descriptors_fail_closed_before_intent(): void {
        $r=$this->candidate();$release=$this->root.'/release.json';file_put_contents($release,Operator::json($r));
        $approval=['version'=>1,'approval_id'=>'synthetic-batch','writer'=>'synthetic-writer','expires_utc'=>gmdate('Y-m-d\TH:i:s\Z',time()+3600),
            'release_sha256'=>hash('sha256',Operator::json($r)),'operations'=>['upload-token','check-missing','upload','upsert-hashes','create-once','observe','readback']];
        foreach(['bad-json','oversized','pipe','bad-token','missing-helper'] as $fault){
            $a=tmpfile();$token=tmpfile();
            fwrite($a,match($fault){'bad-json'=>'{synthetic-secret','oversized'=>str_repeat('x',65537),default=>Operator::json($approval)});
            fwrite($token,$fault==='bad-token'?"synthetic token\n":'synthetic-token');
            $descriptors=[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w'],8=>$fault==='pipe'?['pipe','r']:$a,9=>$token];
            $p=proc_open([PHP_BINARY,'/opt/static-launch/publish.php','submit',$this->root.'/state',$release],$descriptors,$pipes,null,[]);
            self::assertIsResource($p);fclose($pipes[0]);if(isset($pipes[8]))fclose($pipes[8]);
            $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
            self::assertSame(1,proc_close($p),$fault);fclose($a);fclose($token);
            self::assertSame('',$out);self::assertSame("static_launch_stopped\n",$err);self::assertSame([],glob($this->root.'/state/*.intent'));
        }
    }
}
