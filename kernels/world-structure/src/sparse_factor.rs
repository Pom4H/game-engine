//! Pure f64 sparse Cholesky and triangular solves. The caller owns material
//! laws, topology/order, assembly and time integration; no simulation is here.
const MAX_DIMENSION:usize=768;
pub struct SparseFactor {
    n:usize, nnz:usize, configured:bool, factored:bool,
    matrix:Vec<f64>, rhs:Vec<f64>, work:Vec<f64>,
    lower_offsets:Vec<u32>, lower_columns:Vec<u16>,
    upper_offsets:Vec<u32>, upper_rows:Vec<u16>, upper_entries:Vec<u32>,
    lower:Vec<f64>, upper_values:Vec<f64>, diagonal:Vec<f64>,
}
impl SparseFactor {
    pub fn new(n:usize,nnz:usize)->Option<Self>{
        if n==0||n>MAX_DIMENSION||nnz>n*(n-1)/2{return None;}
        Some(Self{n,nnz,configured:false,factored:false,matrix:vec![0.0;n*n],rhs:vec![0.0;n],work:vec![0.0;n],lower_offsets:vec![0;n+1],lower_columns:vec![0;nnz],upper_offsets:vec![0;n+1],upper_rows:vec![0;nnz],upper_entries:vec![0;nnz],lower:vec![0.0;nnz],upper_values:vec![0.0;nnz],diagonal:vec![0.0;n]})
    }
    pub fn configure(&mut self)->bool{
        self.configured=false;self.factored=false;
        for offsets in [&self.lower_offsets,&self.upper_offsets]{if offsets[0]!=0||offsets[self.n]as usize!=self.nnz||offsets.windows(2).any(|s|s[0]>s[1]||s[1]as usize>self.nnz){return false;}}
        for i in 0..self.n{let mut previous=None;for e in self.lower_offsets[i]as usize..self.lower_offsets[i+1]as usize{let col=self.lower_columns[e]as usize;if col>=i||previous.map_or(false,|p|col<=p){return false;}previous=Some(col);}}
        let mut seen=vec![false;self.nnz];
        for col in 0..self.n{let mut previous=None;for e in self.upper_offsets[col]as usize..self.upper_offsets[col+1]as usize{let row=self.upper_rows[e]as usize;let at=self.upper_entries[e]as usize;if row<=col||row>=self.n||previous.map_or(false,|p|row<=p)||at>=self.nnz||at<self.lower_offsets[row]as usize||at>=self.lower_offsets[row+1]as usize||self.lower_columns[at]as usize!=col||seen[at]{return false;}seen[at]=true;previous=Some(row);}}
        if seen.iter().any(|v|!*v){return false;}self.configured=true;true
    }
    pub fn factor(&mut self)->bool{
        self.factored=false;if !self.configured{return false;}
        // Identical sorted lower-row intersection order to the JS reference.
        // The assembled matrix is read-only, so a rejected factor can fall back.
        for i in 0..self.n{let start=self.lower_offsets[i]as usize;let end=self.lower_offsets[i+1]as usize;let columns=&self.lower_columns[start..end];let(prior,current)=self.lower.split_at_mut(start);let values=&mut current[..end-start];
            for (e,&column) in columns.iter().enumerate(){let j=column as usize;let mut value=self.matrix[i*self.n+j];let from=self.lower_offsets[j]as usize;let to=self.lower_offsets[j+1]as usize;let other_columns=&self.lower_columns[from..to];let other_values=&prior[from..to];let mut a=0;let mut b=0;
                // Strictly sorted CSR means the current row's entries before
                // e are exactly those below j. Slices keep bounds checks out of
                // the inner intersection without changing accumulation order.
                while a<e&&b<other_columns.len(){let x=columns[a];let y=other_columns[b];if x==y{value-=values[a]*other_values[b];a+=1;b+=1;}else if x<y{a+=1;}else{b+=1;}}
                values[e]=value/self.diagonal[j];
            }
            let mut d=self.matrix[i*self.n+i];for &value in values.iter(){d-=value*value;}if !(d>0.0&&d.is_finite()){return false;}self.diagonal[i]=d.sqrt();
        }
        // The exact transpose values are resident for every RHS. Repeated
        // backward solves need no CSR-entry gather or additional allocation.
        for (e,&at) in self.upper_entries.iter().enumerate(){self.upper_values[e]=self.lower[at as usize];}self.factored=true;true
    }
    pub fn solve(&mut self)->bool{
        if !self.factored||self.rhs.iter().any(|v|!v.is_finite()){return false;}self.work.copy_from_slice(&self.rhs);let mut first=0;while first<self.n&&self.work[first]==0.0{first+=1;}
        for i in first..self.n{let mut x=self.work[i];let from=self.lower_offsets[i]as usize;let to=self.lower_offsets[i+1]as usize;for (&col,&value) in self.lower_columns[from..to].iter().zip(&self.lower[from..to]){let k=col as usize;if k>=first{x-=value*self.work[k];}}self.work[i]=x/self.diagonal[i];if !self.work[i].is_finite(){return false;}}
        for i in (0..self.n).rev(){let mut x=self.work[i];let from=self.upper_offsets[i]as usize;let to=self.upper_offsets[i+1]as usize;for (&row,&value) in self.upper_rows[from..to].iter().zip(&self.upper_values[from..to]){x-=value*self.work[row as usize];}self.work[i]=x/self.diagonal[i];if !self.work[i].is_finite(){return false;}}
        self.rhs.copy_from_slice(&self.work);true
    }
    #[cfg(target_arch="wasm32")]
    fn field(&mut self,index:u32)->u32{match index{0=>self.matrix.as_mut_ptr()as u32,1=>self.rhs.as_mut_ptr()as u32,2=>self.lower_offsets.as_mut_ptr()as u32,3=>self.lower_columns.as_mut_ptr()as u32,4=>self.upper_offsets.as_mut_ptr()as u32,5=>self.upper_rows.as_mut_ptr()as u32,6=>self.upper_entries.as_mut_ptr()as u32,7=>self.lower.as_mut_ptr()as u32,8=>self.diagonal.as_mut_ptr()as u32,_=>0}}
}

#[cfg(target_arch="wasm32")]
mod abi{
    use super::*;use std::cell::RefCell;
    // Opaque monotonic IDs, never raw Box pointers. Bounded registry per instance.
    struct Registry{next:u32,entries:Vec<(u32,SparseFactor)>}
    thread_local!{static FACTORS:RefCell<Registry>=const{RefCell::new(Registry{next:1,entries:Vec::new()})};}
    #[no_mangle]pub extern "C" fn world_structure_factor_new(n:u32,nnz:u32)->u32{FACTORS.with(|f|{let mut r=f.borrow_mut();if r.entries.len()>=8||r.next==u32::MAX{return 0;}let Some(value)=SparseFactor::new(n as usize,nnz as usize)else{return 0;};let id=r.next;r.next+=1;r.entries.push((id,value));id})}
    #[no_mangle]pub extern "C" fn world_structure_factor_free(id:u32)->u32{FACTORS.with(|f|{let mut r=f.borrow_mut();let Some(i)=r.entries.iter().position(|(key,_)|*key==id)else{return 0;};r.entries.swap_remove(i);1})}
    #[no_mangle]pub extern "C" fn world_structure_factor_field(id:u32,index:u32)->u32{FACTORS.with(|f|f.borrow_mut().entries.iter_mut().find(|(key,_)|*key==id).map_or(0,|(_,e)|e.field(index)))}
    #[no_mangle]pub extern "C" fn world_structure_factor_configure(id:u32)->u32{FACTORS.with(|f|f.borrow_mut().entries.iter_mut().find(|(key,_)|*key==id).map_or(0,|(_,e)|e.configure()as u32))}
    #[no_mangle]pub extern "C" fn world_structure_factor_factorize(id:u32)->u32{FACTORS.with(|f|f.borrow_mut().entries.iter_mut().find(|(key,_)|*key==id).map_or(0,|(_,e)|e.factor()as u32))}
    #[no_mangle]pub extern "C" fn world_structure_factor_solve(id:u32)->u32{FACTORS.with(|f|f.borrow_mut().entries.iter_mut().find(|(key,_)|*key==id).map_or(0,|(_,e)|e.solve()as u32))}
}

#[cfg(test)]mod tests{
    use super::*;
    fn full(n:usize)->SparseFactor{let mut s=SparseFactor::new(n,n*(n-1)/2).unwrap();let mut at=0;for i in 0..n{s.lower_offsets[i]=at;for j in 0..i{s.lower_columns[at as usize]=j as u16;at+=1;}}s.lower_offsets[n]=at;let mut at=0;for j in 0..n{s.upper_offsets[j]=at;for i in j+1..n{s.upper_rows[at as usize]=i as u16;s.upper_entries[at as usize]=(i*(i-1)/2+j)as u32;at+=1;}}s.upper_offsets[n]=at;assert!(s.configure());s}
    #[test]fn positive_factor_solves_and_does_not_change_assembled_matrix(){for n in [1,3,12,72]{let mut s=full(n);for i in 0..n{for j in 0..n{s.matrix[i*n+j]=if i==j{n as f64+1.0}else{0.1};}s.rhs[i]=(i as f64*0.17).sin();}let matrix=s.matrix.clone();let rhs=s.rhs.clone();let ptr=s.work.as_ptr();assert!(s.factor());for _ in 0..4{s.rhs.copy_from_slice(&rhs);assert!(s.solve());for i in 0..n{let actual=(0..n).map(|j|matrix[i*n+j]*s.rhs[j]).sum::<f64>();assert!((actual-rhs[i]).abs()<1e-12);}assert_eq!(ptr,s.work.as_ptr());assert_eq!(matrix,s.matrix);}}}
    #[test]fn invalid_topology_and_nonpositive_factor_are_rejected(){assert!(SparseFactor::new(769,0).is_none());assert!(SparseFactor::new(3,4).is_none());let mut s=full(3);s.lower_columns[0]=2;assert!(!s.configure());let mut s=full(3);assert!(!s.factor());s.matrix.fill(0.0);for i in 0..3{s.matrix[i*3+i]=1.0;}assert!(s.factor());s.rhs[0]=f64::NAN;assert!(!s.solve());assert!(s.rhs[0].is_nan());}
}
