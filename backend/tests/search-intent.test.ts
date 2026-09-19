import test from 'node:test';
import assert from 'node:assert/strict';
import {searchIntent} from '../../frontend/lib/search-intent.ts';
test('natural search preserves role and extracts location, fresher, work mode and salary preference',()=>{
 const countries=['India','United States','United Kingdom','United Arab Emirates'];
 assert.deepEqual(searchIntent('React jobs for freshers, remote, India',countries),{role:'React',country:'India',mode:'Remote',experience:'0',highSalary:false});
 assert.deepEqual(searchIntent('I am a fresher looking for remote React jobs with good salary.',countries),{role:'React',country:'',mode:'Remote',experience:'0',highSalary:true});
 assert.equal(searchIntent('IT support jobs UAE',countries).role,'IT support');
 assert.equal(searchIntent('IT support jobs UAE',countries).country,'United Arab Emirates');
});
