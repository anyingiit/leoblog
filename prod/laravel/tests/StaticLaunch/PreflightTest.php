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
    private function candidate(bool $extra=false,string $fault=''): array {
        $git=str_repeat('f',40);$dirty=str_repeat('0',64);$utc='2026-09-14T10:23:32.000Z';
        $public=Operator::json(['git_sha'=>$git,'posts'=>[['slug'=>'hello-world','title'=>'博客上线了','body'=>'synthetic test body']],
            'media'=>[],'approved'=>[],'timeline'=>['events'=>[]]]);
        $content=hash('sha256',$public);
        $manifest=Operator::json(['provenance'=>'owner-static','git_sha'=>$git,'dirty_sha256'=>$dirty,'build_utc'=>$utc,'content_sha'=>$content,'body_sha256'=>hash('sha256','synthetic test body')]);
        $mh=hash('sha256',$manifest);$marker=hash('sha256',"1\n$content\n$mh");
        $identity=Operator::json(['version'=>1,'generation'=>1,'content_sha'=>$content,'approval_manifest_hash'=>$mh]);
        foreach(['public.json'=>$public,'manifest.json'=>$manifest,'publication-identity.json'=>$identity] as $n=>$b)file_put_contents($this->root.'/input/'.$n,$b);
        $origin='https://douseful.eu.org';
        $home='<meta name="leoblog-version" content="'.$marker.'"><link rel="canonical" href="'.$origin.'/"><h1>synthetic</h1>';
        $article='<meta name="leoblog-version" content="'.$marker.'"><link rel="canonical" href="'.$origin.'/posts/hello-world"><h1>synthetic</h1>';
        $missing='<meta name="leoblog-version" content="'.$marker.'"><meta name="robots" content="noindex, nofollow"><h1>synthetic</h1>';
        $sitemap='<?xml version="1.0" encoding="UTF-8"?>'."\n".'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'.$origin.'/</loc></url><url><loc>'.$origin.'/posts/hello-world</loc></url></urlset>'."\n";
        $robots="User-agent: *\nAllow: /\nSitemap: {$origin}/sitemap.xml\n";
        if($fault==='duplicate-canonical')$home.="<LINK REL='canonical' HREF='https://evil.example/'>";
        $files=[];$tar='';
        foreach(['index.html'=>$home,'404.html'=>$missing,'posts/hello-world/index.html'=>$article,'robots.txt'=>$robots,'sitemap.xml'=>$sitemap] as $name=>$bytes){$tar.=$this->entry($name,$bytes);$files[]=['path'=>'/'.$name,'size'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)];}
        $tar.=$this->entry('manifest.json',Operator::json(['version'=>1,'routes'=>['/','/posts/hello-world'],'files'=>$files]));
        if($extra)$tar.=$this->entry('unexpected.js','bad');
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
        $r=$this->candidate(true);$this->expectException(\RuntimeException::class);Preflight::check($r);
    }
    public function test_preflight_rejects_second_canonical_with_case_and_quote_variants(): void {
        $r=$this->candidate(false,'duplicate-canonical');
        $this->expectException(\RuntimeException::class);Preflight::check($r);
    }
    public function test_shared_uploader_captures_bytes_without_resolver_and_returns_after_cleanup(): void {
        ini_set('memory_limit','512M');$r=$this->candidate();$calls=0;
        $hasher=new class implements PagesAssetHasher {
            public array $captured=[];
            public function hash(array $files): array {$this->captured=$files;return array_map(fn($f)=>['path'=>$f['path'],'hash'=>md5(base64_decode($f['content']))],$files);}
        };
        $http=new Factory;$http->preventStrayRequests();
        $http->fake(function()use(&$calls){$calls++;return Create::promiseFor(new Response(200,[],json_encode(match($calls){1=>['success'=>true,'result'=>['jwt'=>'synthetic.jwt']],2=>['success'=>true,'result'=>[]],default=>['success'=>true]})));});
        $uploader=new PagesPreparedAssetUploader(new TarGzArtifactVerifier($r['artifact_root'],$r['temp_root']),$hasher,new PagesAssetUploader($http,$r['account_id'],$r['project_name'],'synthetic-token'));
        $manifest=$uploader->upload($r['artifact_path'],$r['artifact_hash'],$r['marker']);
        self::assertCount(6,$manifest);self::assertCount(6,$hasher->captured);self::assertSame(3,$calls);self::assertSame(['.','..'],scandir($r['temp_root']));
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
