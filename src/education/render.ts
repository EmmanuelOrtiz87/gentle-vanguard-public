/** Render a validated teaching package with the client's bundled docx runtime.
 * Run the Documents skill's artifact marker before this command, then render
 * and inspect both DOCX files. This does not grant pedagogical approval. */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateEducationPackage, type EducationPackage } from './service.js';
const [input, directory] = process.argv.slice(2);
const packages = process.env.GV_DOCUMENT_PACKAGES;
if (!input || !directory || !packages) throw new Error('Uso: GV_DOCUMENT_PACKAGES=<paquetes del runtime> node --import tsx src/education/render.ts paquete.json carpeta-nueva');
const p: EducationPackage = JSON.parse(readFileSync(input,'utf8'));
const errors = validateEducationPackage(p, false);
if(errors.length) throw new Error(errors.join('\n'));
const require = createRequire(resolve(packages, '_education-runtime.cjs'));
const {Document,Packer,Paragraph,HeadingLevel,TextRun,Footer,PageNumber} = require('docx');
const out=resolve(directory);
if(existsSync(out)) throw new Error('La carpeta de salida debe ser nueva para preservar entregas existentes.');
mkdirSync(out,{recursive:true});
const para = (text:string) => new Paragraph({children:[new TextRun(text)],spacing:{after:120}});
const heading = (text:string) => new Paragraph({text,heading:HeadingLevel.HEADING_1,spacing:{before:200,after:140}});
const title = (text:string) => new Paragraph({text,heading:HeadingLevel.TITLE});
const lines = (text:string) => text.split('\n').map(para);
const state=validateEducationPackage(p,true).length ? 'BORRADOR INTERNO — pendiente de revisión pedagógica y curricular' : 'Revisión registrada en el expediente';
const teacher:any[]=[title(p.title),para('Guía docente'),para(state),para(`Nivel: ${p.level}`),para(p.context),heading('Fuentes y alcance'),...p.curriculum.map(c=>para(`${c.id}: ${c.reference}`)),heading('Objetivos y evidencias'),...p.objectives.map(o=>para(`${o.id}: ${o.text} — fuente ${o.sourceId}`))];
for(const l of p.lessons){teacher.push(heading(`${l.id} ${l.title}`),para(`${l.area} · ${l.duration} minutos · objetivos ${l.objectiveIds.join(', ')}`));for(const m of l.moments)teacher.push(heading(`${m.name} ${m.minutes} minutos`),para(`Intervención docente: ${m.teacher}`),para(`Actividad del estudiante: ${m.student}`));teacher.push(para(`Materiales: ${l.resourceIds.join(', ')}`));}
teacher.push(heading('Evaluación y solucionario reservado al docente'));
for(const a of p.assessments)teacher.push(heading(a.id),...lines(a.instructions),para(`Respuesta u orientación: ${a.answerKey}`),para(`Criterios observables: ${a.criteria}`));
teacher.push(heading('Registro de revisión'),para(p.review.status==='pending'?'No existe aprobación pedagógica humana registrada. El documento no es una entrega final.':`${p.review.reviewer} · ${p.review.reviewedOn} · ${p.review.evidence}`));
const student:any[]=[title(p.title),para('Material del estudiante'),para(state)];
for(const [index,r] of p.resources.entries())student.push(new Paragraph({text:r.title,heading:HeadingLevel.HEADING_1,pageBreakBefore:index>0}),...lines(r.content));
for(const a of p.assessments)student.push(new Paragraph({text:`Evaluación ${a.id}`,heading:HeadingLevel.HEADING_1,pageBreakBefore:true}),...lines(a.instructions));
for(const [name,children]of [['guia-docente',teacher],['material-alumno',student]] as const){
 const document=new Document({creator:'Gentle Vanguard',title:p.title,styles:{default:{document:{run:{font:'Arial',size:22,color:'000000'},paragraph:{spacing:{line:276}}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',run:{font:'Arial',size:34,bold:true,color:'000000'}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',run:{font:'Arial',size:26,bold:true,color:'000000'},paragraph:{keepNext:true}}]},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1134,right:1134}}},footers:{default:new Footer({children:[new Paragraph({children:[new TextRun({children:['Gentle Vanguard · ',PageNumber.CURRENT]})]})]})},children}]});
 writeFileSync(resolve(out,`${name}.docx`),await Packer.toBuffer(document));
}
console.log(JSON.stringify({out,status:state,files:['guia-docente.docx','material-alumno.docx']}));
