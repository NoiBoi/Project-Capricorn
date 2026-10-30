import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {listPackage,extractFile} from '@electron/asar';
const directory=process.argv[2],output=process.argv[3];
const asar=path.join(directory,'win-unpacked/resources/app.asar'),listing=listPackage(asar),files=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else{const name=path.relative(process.cwd(),p).replaceAll('\\','/');if(name.endsWith('.map'))continue;const expected=fs.readFileSync(p),actual=extractFile(asar,path.normalize(name));files.push({file:name,bytes:actual.length,match:hash(expected)===hash(actual)});}}}
walk('dist');const pkg=JSON.parse(extractFile(asar,'package.json').toString()),installer=path.join(directory,'Capri-Setup-'+pkg.version+'.exe');
const forbidden=listing.filter(x=>/(?:^|[\\/])(?:\.env(?:\..*)?|secrets\.bin|history\.jsonl|memory\.json|settings\.json)$/.test(x));
const report={version:pkg.version,buildFiles:files.length,matchingFiles:files.filter(x=>x.match).length,forbiddenPaths:forbidden,mainSha256:hash(extractFile(asar,path.normalize('dist/main/index.js'))),installerSha256:hash(fs.readFileSync(installer)),installerBytes:fs.statSync(installer).size,nativeKoffi:fs.existsSync(path.join(directory,'win-unpacked/resources/koffi/win32_x64/koffi.node')),files};
fs.writeFileSync(output,JSON.stringify(report,null,2));if(report.matchingFiles!==report.buildFiles||forbidden.length||!report.nativeKoffi)process.exitCode=1;
