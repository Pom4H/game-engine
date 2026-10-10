//! World source -> versioned, little-endian WSCN. No runtime language evaluator.
//! This compiler intentionally has no third-party dependencies.
use std::collections::{HashMap, HashSet};
use std::fmt;

pub const HEADER_BYTES: usize = 160;
pub const RECORD_BYTES: usize = 160;
const MAX_ENTITIES: usize = 20_000;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MATERIALS: [&str; 11] = [
    "default", "glass", "steel", "wood", "concrete", "asphalt", "snow", "rubber",
    "plastic", "aluminum", "mirror",
];

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub at: usize,
    pub message: String,
}
impl CompileError {
    fn new(at: usize, message: impl Into<String>) -> Self {
        Self { at, message: message.into() }
    }
    pub fn located(&self, source: &str) -> String {
        let prefix = &source[..self.at.min(source.len())];
        let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
        let col = prefix.rsplit('\n').next().unwrap_or("").chars().count() + 1;
        format!("{line}:{col}: {}", self.message)
    }
}
impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "at byte {}: {}", self.at, self.message)
    }
}
impl std::error::Error for CompileError {}

type Result<T> = std::result::Result<T, CompileError>;

#[derive(Clone, Debug, PartialEq)]
enum Kind {
    Ident(String),
    Number(f64, String),
    LBrace, RBrace, LParen, RParen, LBracket, RBracket,
    Colon, Comma, Semi, Equal, Plus, Minus, Star, Slash, Eof,
}
#[derive(Clone, Debug)]
struct Token { kind: Kind, at: usize }

fn lex(input: &str) -> Result<Vec<Token>> {
    let mut tokens = Vec::new();
    let mut i = 0;
    let bytes = input.as_bytes();
    while i < bytes.len() {
        let ch = input[i..].chars().next().unwrap();
        if ch.is_whitespace() { i += ch.len_utf8(); continue; }
        if ch == '#' || (ch == '/' && bytes.get(i + 1) == Some(&b'/')) {
            while i < bytes.len() && bytes[i] != b'\n' { i += 1; }
            continue;
        }
        let start = i;
        let punctuation = match ch {
            '{' => Some(Kind::LBrace), '}' => Some(Kind::RBrace),
            '(' => Some(Kind::LParen), ')' => Some(Kind::RParen),
            ':' => Some(Kind::Colon), ',' => Some(Kind::Comma),
            ';' => Some(Kind::Semi), '=' => Some(Kind::Equal),
            '[' => Some(Kind::LBracket), ']' => Some(Kind::RBracket),
            '+' => Some(Kind::Plus), '-' => Some(Kind::Minus),
            '*' => Some(Kind::Star), '/' => Some(Kind::Slash), _ => None,
        };
        if let Some(kind) = punctuation {
            tokens.push(Token { kind, at: i });
            i += 1;
            continue;
        }
        if ch.is_alphabetic() || ch == '_' {
            i += ch.len_utf8();
            while i < bytes.len() {
                let next = input[i..].chars().next().unwrap();
                if next.is_alphanumeric() || next == '_' || next == '-' {
                    i += next.len_utf8();
                } else { break; }
            }
            tokens.push(Token { kind: Kind::Ident(input[start..i].to_string()), at: start });
            continue;
        }
        if ch.is_ascii_digit() || ch == '.' {
            let mut digits = 0usize;
            while bytes.get(i).is_some_and(u8::is_ascii_digit) { i += 1; digits += 1; }
            if bytes.get(i) == Some(&b'.') {
                i += 1;
                while bytes.get(i).is_some_and(u8::is_ascii_digit) { i += 1; digits += 1; }
            }
            if digits == 0 { return Err(CompileError::new(start, "expected a number")); }
            if bytes.get(i).is_some_and(|value| *value == b'e' || *value == b'E') {
                let e = i;
                i += 1;
                if bytes.get(i).is_some_and(|value| *value == b'+' || *value == b'-') { i += 1; }
                let before = i;
                while bytes.get(i).is_some_and(u8::is_ascii_digit) { i += 1; }
                if i == before { return Err(CompileError::new(e, "invalid exponent")); }
            }
            let value: f64 = input[start..i].parse().map_err(|_| CompileError::new(start, "invalid number"))?;
            if !value.is_finite() { return Err(CompileError::new(start, "non-finite number")); }
            let unit_start = i;
            while i < bytes.len() {
                let next = input[i..].chars().next().unwrap();
                if next.is_alphabetic() || next == '°' || next == '²'
                    || (i > unit_start && next.is_ascii_digit())
                    || (next == '/' && i > unit_start && bytes.get(i + 1).is_some_and(u8::is_ascii_alphabetic)) {
                    i += next.len_utf8();
                } else { break; }
            }
            tokens.push(Token { kind: Kind::Number(value, input[unit_start..i].to_string()), at: start });
            continue;
        }
        return Err(CompileError::new(i, format!("unexpected character {ch:?}")));
    }
    tokens.push(Token { kind: Kind::Eof, at: input.len() });
    Ok(tokens)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Dimension { Scalar, Length, Speed, Acceleration, Mass, Angle, Temperature, Time }
fn convert(value: f64, unit: &str, dimension: Dimension, at: usize) -> Result<f64> {
    let factor = match (dimension, unit) {
        (Dimension::Scalar, "") => 1.0,
        (Dimension::Length, "m") => 1.0,
        (Dimension::Length, "cm") => 0.01,
        (Dimension::Length, "mm") => 0.001,
        (Dimension::Speed, "m/s") => 1.0,
        (Dimension::Speed, "km/h") => 1.0 / 3.6,
        (Dimension::Acceleration, "m/s2" | "m/s²") => 1.0,
        (Dimension::Mass, "kg") => 1.0,
        (Dimension::Mass, "g") => 0.001,
        (Dimension::Angle, "rad") => 1.0,
        (Dimension::Angle, "deg") => std::f64::consts::PI / 180.0,
        (Dimension::Temperature, "C" | "°C") => 1.0,
        (Dimension::Time, "s") => 1.0,
        (Dimension::Time, "ms") => 0.001,
        (Dimension::Time, "us") => 0.000001,
        _ => {
            let expected = match dimension {
                Dimension::Scalar => "unitless", Dimension::Length => "m/cm/mm",
                Dimension::Speed => "m/s or km/h", Dimension::Acceleration => "m/s2",
                Dimension::Mass => "kg/g", Dimension::Angle => "deg/rad",
                Dimension::Temperature => "C", Dimension::Time => "s/ms/us",
            };
            return Err(CompileError::new(at, format!("unit {unit:?} is invalid; expected {expected}")));
        }
    };
    let result = value * factor;
    if !result.is_finite() { return Err(CompileError::new(at, "unit conversion overflow")); }
    Ok(result)
}

#[derive(Clone, Copy, Debug)]
struct Quantity { value: f64, dimension: Dimension }

fn unit_name(dimension: Dimension) -> &'static str {
    match dimension {
        Dimension::Scalar => "unitless",
        Dimension::Length => "m/cm/mm",
        Dimension::Speed => "m/s or km/h",
        Dimension::Acceleration => "m/s2",
        Dimension::Mass => "kg/g",
        Dimension::Angle => "deg/rad",
        Dimension::Temperature => "C", Dimension::Time => "s/ms/us",
    }
}
fn literal(value: f64, unit: &str, at: usize) -> Result<Quantity> {
    let dimension = match unit {
        "" => Dimension::Scalar,
        "m" | "cm" | "mm" => Dimension::Length,
        "m/s" | "km/h" => Dimension::Speed,
        "m/s2" | "m/s²" => Dimension::Acceleration,
        "kg" | "g" => Dimension::Mass,
        "deg" | "rad" => Dimension::Angle,
        "C" | "°C" => Dimension::Temperature,
        "s" | "ms" | "us" => Dimension::Time,
        _ => return Err(CompileError::new(at, format!("unknown unit {unit:?}"))),
    };
    Ok(Quantity { value: convert(value, unit, dimension, at)?, dimension })
}

#[derive(Default)]
struct Camera { position: [f64; 3], target: [f64; 3], fov_deg: f64 }
struct Entity {
    id: String, position: [f64; 3], rotation: [f64; 3], scale: [f64; 3],
    mesh: u8, dimensions: [f64; 3], material: u8, body_mass: Option<f64>,
    velocity: Option<[f64; 3]>, render_only: bool, roughness: Option<f64>,
    friction: Option<f64>, restitution: Option<f64>, snow_depth: Option<f64>,
}
impl Entity {
    fn new(id: String) -> Self {
        Self {
            id, position: [0.0; 3], rotation: [0.0; 3], scale: [1.0; 3],
            mesh: 0, dimensions: [0.0; 3], material: 0, body_mass: None,
            velocity: None, render_only: false, roughness: None,
            friction: None, restitution: None, snow_depth: None,
        }
    }
}
#[derive(Clone, Copy)]
struct Performance {budget_ms:f64,sample_every:u32,history:u32}
struct World {
    name: String, seed: u32, gravity: [f64; 3], ground: f64,
    camera: Option<Camera>, temperature: Option<f64>, snowfall: Option<u32>,
    performance: Option<Performance>, entities: Vec<Entity>,
}
impl World {
    fn new(name: String) -> Self {
        Self { name, seed: 0, gravity: [0.0, -9.81, 0.0], ground: 0.0,
            camera: None, temperature: None, snowfall: None, performance: None, entities: Vec::new() }
    }
}

struct Parser {
    tokens: Vec<Token>,
    index: usize,
    constants: HashMap<String, Quantity>,
    entity_index: Option<usize>,
}
impl Parser {
    fn at(&self) -> usize { self.tokens[self.index].at }
    fn peek(&self) -> &Kind { &self.tokens[self.index].kind }
    fn eat(&mut self, kind: Kind) -> bool {
        if self.peek() == &kind { self.index += 1; true } else { false }
    }
    fn expect(&mut self, kind: Kind) -> Result<()> {
        if self.eat(kind.clone()) { Ok(()) } else {
            Err(CompileError::new(self.at(), format!("expected {kind:?}, got {:?}", self.peek())))
        }
    }
    fn ident(&mut self) -> Result<String> {
        let at = self.at();
        if let Kind::Ident(value) = self.peek() {
            let result = value.clone(); self.index += 1; Ok(result)
        } else { Err(CompileError::new(at, "expected an identifier")) }
    }

    fn checked(&self, value: f64, dimension: Dimension, at: usize) -> Result<Quantity> {
        if value.is_finite() { Ok(Quantity { value, dimension }) }
        else { Err(CompileError::new(at, "non-finite constant expression")) }
    }
    fn atom(&mut self) -> Result<Quantity> {
        let at = self.at();
        match self.peek().clone() {
            Kind::Number(value, unit) => {
                self.index += 1;
                literal(value, &unit, at)
            }
            Kind::Ident(name) => {
                self.index += 1;
                if name == "index" {
                    return self.entity_index
                        .map(|index| Quantity { value: index as f64, dimension: Dimension::Scalar })
                        .ok_or_else(|| CompileError::new(at, "index is only available in indexed entities"));
                }
                self.constants.get(&name).copied()
                    .ok_or_else(|| CompileError::new(at, format!("unknown constant {name}")))
            }
            Kind::LParen => {
                self.index += 1;
                let value = self.expression()?;
                self.expect(Kind::RParen)?;
                Ok(value)
            }
            _ => Err(CompileError::new(at, "expected a number, constant, or expression")),
        }
    }
    fn unary(&mut self) -> Result<Quantity> {
        let at = self.at();
        if self.eat(Kind::Minus) {
            let value = self.unary()?;
            self.checked(-value.value, value.dimension, at)
        } else if self.eat(Kind::Plus) { self.unary() }
        else { self.atom() }
    }
    fn product(&mut self) -> Result<Quantity> {
        let mut lhs = self.unary()?;
        loop {
            let at = self.at();
            let multiply = if self.eat(Kind::Star) { true }
                else if self.eat(Kind::Slash) { false }
                else { break };
            let rhs = self.unary()?;
            let dimension = if multiply {
                if lhs.dimension == Dimension::Scalar { rhs.dimension }
                else if rhs.dimension == Dimension::Scalar { lhs.dimension }
                else { return Err(CompileError::new(at, "multiplication of two dimensional values is unsupported")); }
            } else {
                if rhs.value == 0.0 { return Err(CompileError::new(at, "division by zero")); }
                if rhs.dimension == Dimension::Scalar { lhs.dimension }
                else if lhs.dimension == rhs.dimension { Dimension::Scalar }
                else { return Err(CompileError::new(at, "division has incompatible dimensions")); }
            };
            lhs = self.checked(if multiply { lhs.value * rhs.value } else { lhs.value / rhs.value }, dimension, at)?;
        }
        Ok(lhs)
    }
    fn expression(&mut self) -> Result<Quantity> {
        let mut lhs = self.product()?;
        loop {
            let at = self.at();
            let add = if self.eat(Kind::Plus) { true }
                else if self.eat(Kind::Minus) { false }
                else { break };
            let rhs = self.product()?;
            if lhs.dimension != rhs.dimension {
                return Err(CompileError::new(at, format!(
                    "cannot add or subtract {:?} and {:?}", lhs.dimension, rhs.dimension
                )));
            }
            lhs = self.checked(if add { lhs.value + rhs.value } else { lhs.value - rhs.value }, lhs.dimension, at)?;
        }
        Ok(lhs)
    }
    fn number(&mut self, dimension: Dimension) -> Result<f64> {
        let at = self.at();
        let result = self.expression()?;
        if result.dimension != dimension {
            return Err(CompileError::new(at, format!(
                "dimension {:?} is invalid; expected {}", result.dimension, unit_name(dimension)
            )));
        }
        Ok(result.value)
    }
    fn vec3(&mut self, dimension: Dimension) -> Result<[f64; 3]> {
        self.expect(Kind::LParen)?;
        let x = self.number(dimension)?; self.expect(Kind::Comma)?;
        let y = self.number(dimension)?; self.expect(Kind::Comma)?;
        let z = self.number(dimension)?; self.expect(Kind::RParen)?;
        Ok([x, y, z])
    }
    fn property(&mut self) -> Result<String> {
        let key = self.ident()?;
        self.expect(Kind::Colon)?;
        Ok(key)
    }
    fn unique(&self, seen: &mut HashSet<String>, name: &str) -> Result<()> {
        if seen.insert(name.to_string()) { Ok(()) }
        else { Err(CompileError::new(self.at(), format!("duplicate field {name}"))) }
    }
    fn end_field(&mut self) { self.eat(Kind::Semi); }
    fn positive(&self, number: f64, name: &str) -> Result<f64> {
        if number > 0.0 { Ok(number) }
        else { Err(CompileError::new(self.at(), format!("{name} must be positive"))) }
    }
    fn bounded(&self, number: f64, name: &str, low: f64, high: f64) -> Result<f64> {
        if (low..=high).contains(&number) { Ok(number) }
        else { Err(CompileError::new(self.at(), format!("{name} must be in [{low}, {high}]"))) }
    }
    fn boolean(&mut self) -> Result<bool> {
        match self.ident()?.as_str() {
            "true" => Ok(true), "false" => Ok(false),
            _ => Err(CompileError::new(self.at(), "expected true or false")),
        }
    }
    fn camera(&mut self) -> Result<Camera> {
        self.expect(Kind::LBrace)?;
        let mut camera = Camera { fov_deg: 55.0, ..Camera::default() };
        let mut seen = HashSet::new();
        while !self.eat(Kind::RBrace) {
            let key = self.property()?; self.unique(&mut seen, &key)?;
            match key.as_str() {
                "position" => camera.position = self.vec3(Dimension::Length)?,
                "target" => camera.target = self.vec3(Dimension::Length)?,
                "fov" => {
                    let degrees = self.number(Dimension::Angle)? * 180.0 / std::f64::consts::PI;
                    camera.fov_deg = self.bounded(degrees, "camera.fov", 1.0, 179.0)?;
                },
                _ => return Err(CompileError::new(self.at(), format!("unknown camera field {key}"))),
            }
            self.end_field();
        }
        if !seen.contains("position") || !seen.contains("target") {
            return Err(CompileError::new(self.at(), "camera requires position and target"));
        }
        Ok(camera)
    }
    fn environment(&mut self, world: &mut World) -> Result<()> {
        self.expect(Kind::LBrace)?;
        let mut seen = HashSet::new();
        while !self.eat(Kind::RBrace) {
            let key = self.property()?; self.unique(&mut seen, &key)?;
            match key.as_str() {
                "temperature" => world.temperature = Some(self.number(Dimension::Temperature)?),
                "snowfall" => {
                    let snowfall = self.ident()?;
                    world.snowfall = Some(match snowfall.as_str() {
                        "none" => 0, "light" => 1, "moderate" => 2, "heavy" => 3,
                        _ => return Err(CompileError::new(self.at(), "snowfall must be none/light/moderate/heavy")),
                    });
                }
                _ => return Err(CompileError::new(self.at(), format!("unknown environment field {key}"))),
            }
            self.end_field();
        }
        Ok(())
    }

    fn performance(&mut self) -> Result<Performance> {
        self.expect(Kind::LBrace)?;
        let mut perf=Performance {budget_ms:0.0,sample_every:1,history:120};
        let mut seen=HashSet::new();
        while !self.eat(Kind::RBrace) {
            let key=self.property()?; self.unique(&mut seen,&key)?;
            match key.as_str() {
                "tick_budget" => {
                    let seconds=self.number(Dimension::Time)?;
                    perf.budget_ms=self.bounded(seconds*1000.0,"tick_budget",0.001,1000.0)?;
                },
                "sample_every" | "history" => {
                    let n=self.number(Dimension::Scalar)?;
                    let (low,high)=if key=="sample_every" {(1.0,1024.0)} else {(8.0,4096.0)};
                    self.bounded(n,&key,low,high)?;
                    if n.fract()!=0.0 {return Err(CompileError::new(self.at(),format!("{key} must be an integer")));}
                    if key=="sample_every" {perf.sample_every=n as u32;} else {perf.history=n as u32;}
                },
                _ => return Err(CompileError::new(self.at(),format!("unknown performance field {key}"))),
            }
            self.end_field();
        }
        if !seen.contains("tick_budget"){return Err(CompileError::new(self.at(),"performance requires tick_budget"));}
        Ok(perf)
    }
    fn mesh(&mut self, entity: &mut Entity) -> Result<()> {
        let kind = self.ident()?;
        self.expect(Kind::LParen)?;
        match kind.as_str() {
            "box" => {
                entity.mesh = 1;
                let x = { let value = self.number(Dimension::Length)?; self.positive(value, "box.width")? };
                self.expect(Kind::Comma)?;
                let y = { let value = self.number(Dimension::Length)?; self.positive(value, "box.height")? };
                self.expect(Kind::Comma)?;
                let z = { let value = self.number(Dimension::Length)?; self.positive(value, "box.depth")? };
                entity.dimensions = [x, y, z];
            }
            "sphere" => {
                entity.mesh = 2;
                entity.dimensions[0] = { let value = self.number(Dimension::Length)?; self.positive(value, "sphere.radius")? };
            }
            "plane" => {
                entity.mesh = 3;
                let x = { let value = self.number(Dimension::Length)?; self.positive(value, "plane.width")? };
                self.expect(Kind::Comma)?;
                let z = { let value = self.number(Dimension::Length)?; self.positive(value, "plane.depth")? };
                entity.dimensions = [x, z, 0.0];
            }
            "cylinder" => {
                entity.mesh = 4;
                let radius = { let value = self.number(Dimension::Length)?; self.positive(value, "cylinder.radius")? };
                self.expect(Kind::Comma)?;
                let height = { let value = self.number(Dimension::Length)?; self.positive(value, "cylinder.height")? };
                entity.dimensions = [radius, height, 0.0];
            }
            _ => return Err(CompileError::new(self.at(), format!("unknown mesh {kind}"))),
        }
        self.expect(Kind::RParen)
    }
    fn entity(&mut self, id: String) -> Result<Entity> {
        if id.len() > 180 { return Err(CompileError::new(self.at(), "entity id exceeds 180 UTF-8 bytes")); }
        self.expect(Kind::LBrace)?;
        let mut entity = Entity::new(id);
        let mut seen = HashSet::new();
        while !self.eat(Kind::RBrace) {
            let key = self.property()?; self.unique(&mut seen, &key)?;
            match key.as_str() {
                "position" => entity.position = self.vec3(Dimension::Length)?,
                "rotation" => entity.rotation = self.vec3(Dimension::Angle)?,
                "scale" => {
                    entity.scale = self.vec3(Dimension::Scalar)?;
                    if entity.scale.iter().any(|value| *value <= 0.0) {
                        return Err(CompileError::new(self.at(), "scale components must be positive"));
                    }
                }
                "mesh" => self.mesh(&mut entity)?,
                "material" => {
                    let value = self.ident()?;
                    entity.material = MATERIALS.iter().position(|kind| *kind == value)
                        .ok_or_else(|| CompileError::new(self.at(), format!("unknown material {value}")))? as u8;
                }
                "body" => {
                    let kind = self.ident()?;
                    entity.body_mass = Some(match kind.as_str() {
                        "static" => 0.0,
                        "dynamic" => {
                            self.expect(Kind::LParen)?;
                            let mass = self.number(Dimension::Mass)?;
                            self.expect(Kind::RParen)?;
                            self.positive(mass, "dynamic mass")?
                        }
                        _ => return Err(CompileError::new(self.at(), "body must be static or dynamic(mass)")),
                    });
                }
                "velocity" => entity.velocity = Some(self.vec3(Dimension::Speed)?),
                "render_only" => entity.render_only = self.boolean()?,
                "roughness" => {
                    let value = self.number(Dimension::Scalar)?;
                    entity.roughness = Some(self.bounded(value, "roughness", 0.0, 1.0)?);
                }
                "friction" => {
                    let value = self.number(Dimension::Scalar)?;
                    entity.friction = Some(self.bounded(value, "friction", 0.0, 10.0)?);
                }
                "restitution" => {
                    let value = self.number(Dimension::Scalar)?;
                    entity.restitution = Some(self.bounded(value, "restitution", 0.0, 1.0)?);
                }
                "snow_depth" => {
                    let value = self.number(Dimension::Length)?;
                    entity.snow_depth = Some(self.bounded(value, "snow_depth", 0.0, 1.0)?);
                }
                _ => return Err(CompileError::new(self.at(), format!("unknown entity field {key}"))),
            }
            self.end_field();
        }
        if entity.mesh == 0 { return Err(CompileError::new(self.at(), "entity requires a mesh")); }
        if entity.render_only && (entity.body_mass.is_some() || entity.snow_depth.is_some()) {
            return Err(CompileError::new(self.at(), "render_only cannot own body or snow_depth"));
        }
        if entity.velocity.is_some() && !entity.body_mass.is_some_and(|mass| mass > 0.0) {
            return Err(CompileError::new(self.at(), "velocity requires body: dynamic(mass)"));
        }
        if (entity.friction.is_some() || entity.restitution.is_some()) && entity.body_mass.is_none() {
            return Err(CompileError::new(self.at(), "friction/restitution require body"));
        }
        Ok(entity)
    }
    fn world(&mut self) -> Result<World> {
        if self.ident()? != "world" { return Err(CompileError::new(self.at(), "source must begin with world")); }
        let name = self.ident()?;
        self.expect(Kind::LBrace)?;
        let mut world = World::new(name);
        let mut seen = HashSet::new();
        let mut ids = HashSet::new();
        while !self.eat(Kind::RBrace) {
            let key = self.ident()?;
            match key.as_str() {
                "let" => {
                    let name = self.ident()?;
                    if name == "index" || self.constants.contains_key(&name) {
                        return Err(CompileError::new(self.at(), format!("duplicate or reserved constant {name}")));
                    }
                    self.expect(Kind::Equal)?;
                    let value = self.expression()?;
                    self.constants.insert(name, value);
                }
                "entity" => {
                    let name = self.ident()?;
                    let indexed = self.eat(Kind::LBracket);
                    let count = if indexed {
                        let at = self.at();
                        let value = self.number(Dimension::Scalar)?;
                        self.expect(Kind::RBracket)?;
                        if value.fract() != 0.0 || !(1.0..=MAX_ENTITIES as f64).contains(&value) {
                            return Err(CompileError::new(at, "entity count must be an integer in 1..=20000"));
                        }
                        value as usize
                    } else { 1 };
                    if world.entities.len() + count > MAX_ENTITIES {
                        return Err(CompileError::new(self.at(), "too many entities"));
                    }
                    // The body is lexed once; constant expressions are folded for each
                    // index at build time. No loops or expression VM reach Scene ticks.
                    let body_start = self.index;
                    let mut body_end = body_start;
                    for i in 0..count {
                        self.index = body_start;
                        self.entity_index = if indexed { Some(i) } else { None };
                        let id = if indexed { format!("{name}-{i}") } else { name.clone() };
                        let entity = self.entity(id)?;
                        if !ids.insert(entity.id.clone()) {
                            return Err(CompileError::new(self.at(), format!("duplicate entity {}", entity.id)));
                        }
                        body_end = self.index;
                        world.entities.push(entity);
                    }
                    self.entity_index = None;
                    self.index = body_end;
                }
                "performance" => {
                    self.unique(&mut seen,"performance")?;
                    world.performance=Some(self.performance()?);
                }
                "camera" => {
                    self.unique(&mut seen, "camera")?;
                    world.camera = Some(self.camera()?);
                }
                "environment" => {
                    self.unique(&mut seen, "environment")?;
                    self.environment(&mut world)?;
                }
                "seed" | "gravity" | "ground" => {
                    self.unique(&mut seen, &key)?;
                    self.expect(Kind::Colon)?;
                    match key.as_str() {
                        "seed" => {
                            let value = self.number(Dimension::Scalar)?;
                            if value.fract() != 0.0 || !(0.0..=u32::MAX as f64).contains(&value) {
                                return Err(CompileError::new(self.at(), "seed must be a u32 integer"));
                            }
                            world.seed = value as u32;
                        }
                        "gravity" => world.gravity = self.vec3(Dimension::Acceleration)?,
                        "ground" => world.ground = self.number(Dimension::Length)?,
                        _ => unreachable!(),
                    }
                }
                _ => return Err(CompileError::new(self.at(), format!("unknown world item {key}"))),
            }
            self.end_field();
        }
        self.expect(Kind::Eof)?;
        Ok(world)
    }
}

fn u16_at(bytes: &mut [u8], at: usize, number: u16) {
    bytes[at..at + 2].copy_from_slice(&number.to_le_bytes());
}
fn u32_at(bytes: &mut [u8], at: usize, number: u32) {
    bytes[at..at + 4].copy_from_slice(&number.to_le_bytes());
}
fn f32_at(bytes: &mut [u8], at: usize, number: f64) {
    bytes[at..at + 4].copy_from_slice(&(number as f32).to_le_bytes());
}
fn f64_at(bytes: &mut [u8], at: usize, number: f64) {
    bytes[at..at + 8].copy_from_slice(&number.to_le_bytes());
}
fn vec3_at(bytes: &mut [u8], at: usize, vec: [f64; 3]) {
    for (i, value) in vec.into_iter().enumerate() { f64_at(bytes, at + i * 8, value); }
}
fn encode(world: World) -> Result<Vec<u8>> {
    let record_end = HEADER_BYTES + RECORD_BYTES * world.entities.len();
    let mut bytes = vec![0u8; record_end];
    let mut strings = Vec::new();
    let name_offset = 0;
    strings.extend_from_slice(world.name.as_bytes());
    let name_length = strings.len();
    bytes[..4].copy_from_slice(b"WSCN");
    u16_at(&mut bytes, 4, if world.performance.is_some(){2}else{1}); // v1 unprofiled, v2 profiled
    u16_at(&mut bytes, 6, HEADER_BYTES as u16);
    u32_at(&mut bytes, 8, RECORD_BYTES as u32);
    u32_at(&mut bytes, 12, world.entities.len() as u32);
    u32_at(&mut bytes, 16, HEADER_BYTES as u32);
    u32_at(&mut bytes, 20, record_end as u32);
    let mut flags = 0u32;
    if world.camera.is_some() { flags |= 1; }
    if world.temperature.is_some() { flags |= 2; }
    if world.snowfall.is_some() { flags |= 4; }
    u32_at(&mut bytes, 28, flags);
    u32_at(&mut bytes, 32, world.seed);
    vec3_at(&mut bytes, 40, world.gravity);
    f64_at(&mut bytes, 64, world.ground);
    if let Some(camera) = world.camera {
        vec3_at(&mut bytes, 72, camera.position);
        vec3_at(&mut bytes, 96, camera.target);
        f64_at(&mut bytes, 120, camera.fov_deg);
    }
    if let Some(temp) = world.temperature { f64_at(&mut bytes, 128, temp); }
    if let Some(snow) = world.snowfall { u32_at(&mut bytes, 136, snow); }
    u32_at(&mut bytes, 144, name_offset);
    u32_at(&mut bytes, 148, name_length as u32);

    for (index, entity) in world.entities.iter().enumerate() {
        let base = HEADER_BYTES + index * RECORD_BYTES;
        let id_offset = strings.len();
        strings.extend_from_slice(entity.id.as_bytes());
        u32_at(&mut bytes, base, id_offset as u32);
        u16_at(&mut bytes, base + 4, entity.id.len() as u16);
        bytes[base + 6] = entity.mesh;
        bytes[base + 7] = entity.material;
        let mut flags = 0u32;
        if let Some(mass) = entity.body_mass {
            flags |= 1;
            if mass > 0.0 { flags |= 2; }
            f64_at(&mut bytes, base + 112, mass);
        }
        if entity.render_only { flags |= 4; }
        if let Some(roughness) = entity.roughness {
            flags |= 8;
            f32_at(&mut bytes, base + 144, roughness);
        }
        if let Some(velocity) = entity.velocity {
            flags |= 16;
            vec3_at(&mut bytes, base + 120, velocity);
        }
        if let Some(friction) = entity.friction {
            flags |= 32;
            f32_at(&mut bytes, base + 152, friction);
        }
        if let Some(restitution) = entity.restitution {
            flags |= 64;
            f32_at(&mut bytes, base + 156, restitution);
        }
        if let Some(depth) = entity.snow_depth {
            flags |= 128;
            f32_at(&mut bytes, base + 148, depth);
        }
        u32_at(&mut bytes, base + 8, flags);
        vec3_at(&mut bytes, base + 16, entity.position);
        vec3_at(&mut bytes, base + 40, entity.rotation);
        vec3_at(&mut bytes, base + 64, entity.scale);
        vec3_at(&mut bytes, base + 88, entity.dimensions);
    }
    if let Some(performance)=world.performance {
        // ABI v2 opt-in extension; never interpreted in the simulation hot path.
        u32_at(&mut bytes,152,strings.len() as u32);
        u32_at(&mut bytes,156,16);
        strings.extend_from_slice(&performance.budget_ms.to_le_bytes());
        strings.extend_from_slice(&performance.sample_every.to_le_bytes());
        strings.extend_from_slice(&performance.history.to_le_bytes());
    }
    let total = record_end + strings.len();
    if total > MAX_BYTES { return Err(CompileError::new(0, "compiled scene exceeds 32 MiB")); }
    u32_at(&mut bytes, 24, total as u32);
    bytes.extend_from_slice(&strings);
    Ok(bytes)
}

/// Compile a World source file ahead of time. The engine consumes the binary at load,
/// retaining its existing authoritative physics state and tick scheduler.
pub fn compile(source: &str) -> Result<Vec<u8>> {compile_with_performance(source,true)}

/// Release mode validates performance directives but removes profiling metadata.
/// Produces ABI v1 with exactly the same physical entities and scheduling.
pub fn compile_with_performance(source: &str, include_performance: bool) -> Result<Vec<u8>> {
    let tokens=lex(source)?;
    let mut parser=Parser {tokens,index:0,constants:HashMap::new(),entity_index:None};
    let mut world=parser.world()?;
    if !include_performance {world.performance=None;}
    encode(world)
}

#[cfg(test)]
mod tests {
    use super::*;
    const EXAMPLE: &str = r#"
world Collision {
  seed: 42
  gravity: (0m/s2, -9.81m/s2, 0m/s2)
  ground: -100m
  camera {
    position: (8m, 4m, 10m)
    target: (0m, 1m, 0m)
    fov: 55deg
  }
  environment { temperature: -5C; snowfall: light }
  entity floor {
    position: (0m, -0.1m, 0m)
    mesh: box(12m, 0.2m, 12m)
    material: concrete
    body: static
  }
  entity ball {
    position: (0m, 3m, 0m)
    mesh: sphere(50cm)
    material: steel
    body: dynamic(3kg)
    velocity: (1m/s, 0m/s, 0m/s)
    restitution: 0.5
  }
}"#;

    #[test]
    fn deterministic_binary_with_versioned_abi() {
        let a = compile(EXAMPLE).unwrap();
        assert_eq!(a, compile(EXAMPLE).unwrap());
        assert_eq!(&a[..4], b"WSCN");
        assert_eq!(u16::from_le_bytes(a[4..6].try_into().unwrap()), 1);
        assert_eq!(u32::from_le_bytes(a[12..16].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(a[24..28].try_into().unwrap()) as usize, a.len());
    }
    #[test]
    fn rejects_wrong_units_and_ambiguous_velocities() {
        let invalid = EXAMPLE.replace("3kg", "3m");
        assert!(compile(&invalid).unwrap_err().message.contains("expected kg/g"));
        let invalid = EXAMPLE.replace("body: dynamic(3kg)", "body: static");
        assert!(compile(&invalid).unwrap_err().message.contains("velocity requires"));
    }
    #[test]
    fn rejects_duplicates_unknown_fields_and_bad_physics() {
        let duplicate = EXAMPLE.replacen("entity ball {", "entity floor {", 1);
        assert!(compile(&duplicate).unwrap_err().message.contains("duplicate entity"));
        let unknown = EXAMPLE.replace("restitution: 0.5", "teleport: true");
        assert!(compile(&unknown).unwrap_err().message.contains("unknown entity field"));
        let zero_mass = EXAMPLE.replace("dynamic(3kg)", "dynamic(0kg)");
        assert!(compile(&zero_mass).unwrap_err().message.contains("must be positive"));
    }
    #[test]
    fn handles_units_and_source_locations() {
        let binary = compile(EXAMPLE).unwrap();
        let first = HEADER_BYTES;
        let second = HEADER_BYTES + RECORD_BYTES;
        let radius = f64::from_le_bytes(binary[second + 88..second + 96].try_into().unwrap());
        assert_eq!(radius, 0.5);
        assert_eq!(binary[first + 6], 1);
        let error = compile("world X {\n  gravity: (1kg, 2m/s2, 3m/s2)\n}").unwrap_err();
        assert!(error.located("world X {\n  gravity: (1kg, 2m/s2, 3m/s2)\n}").starts_with("2:"));
    }

    #[test]
    fn constant_folding_indexed_entities_preserves_v1_abi() {
        let src = r#"
world Array {
 let spacing = 75cm
 let radius = 1m / 2
 let count = 4
 entity ball[count] {
  position: (index * spacing, 3m + 20cm, 0m)
  mesh: sphere(radius)
  material: steel
  body: dynamic(3kg)
 }
}"#;
        let bytes = compile(src).unwrap();
        assert_eq!(u32::from_le_bytes(bytes[12..16].try_into().unwrap()), 4);
        assert_eq!(u16::from_le_bytes(bytes[4..6].try_into().unwrap()), 1);
        for i in 0..4 {
            let at = HEADER_BYTES + i * RECORD_BYTES;
            let x = f64::from_le_bytes(bytes[at + 16..at + 24].try_into().unwrap());
            let y = f64::from_le_bytes(bytes[at + 24..at + 32].try_into().unwrap());
            let radius = f64::from_le_bytes(bytes[at + 88..at + 96].try_into().unwrap());
            assert_eq!(x, i as f64 * 0.75);
            assert_eq!(y, 3.2);
            assert_eq!(radius, 0.5);
        }
        assert_eq!(bytes, compile(src).unwrap());
    }
    #[test]
    fn expressions_reject_dimension_errors_division_by_zero_and_unknown_names() {
        for (source, message) in [
            ("let x = 2m + 3kg", "cannot add or subtract"),
            ("let x = 2m * 3kg", "multiplication of two dimensional"),
            ("let x = 2m / 0", "division by zero"),
            ("let x = missing", "unknown constant"),
            ("let index = 5", "duplicate or reserved constant"),
            ("let x = 5; let x = 6", "duplicate or reserved constant"),
            ("entity a[0] { mesh: sphere(1m) }", "entity count"),
            ("entity a[2] { mesh: sphere(index) }", "expected m/cm/mm"),
            ("entity a { mesh: sphere(index) }", "index is only available"),
        ] {
            let program = format!("world Bad {{ {source} }}");
            assert!(compile(&program).unwrap_err().message.contains(message),
                "unexpected diagnostic for {source}: {:?}", compile(&program));
        }
    }
    #[test]
    fn operators_keep_precedence_unary_signs_and_old_negative_literals() {
        let src = "world X { let r = 2m + 3 * 1m; entity a { mesh: sphere(r / 5); position: (-1m, -(2m + 1m), +1m) } }";
        let binary = compile(src).unwrap();
        let at = HEADER_BYTES;
        assert_eq!(f64::from_le_bytes(binary[at + 16..at + 24].try_into().unwrap()), -1.0);
        assert_eq!(f64::from_le_bytes(binary[at + 24..at + 32].try_into().unwrap()), -3.0);
        assert_eq!(f64::from_le_bytes(binary[at + 88..at + 96].try_into().unwrap()), 1.0);
    }


    #[test]
    fn performance_block_preserves_entities_and_uses_explicit_v2_extension() {
        let program=EXAMPLE.replace("  seed: 42", "  seed: 42\n  performance { tick_budget: 2.5ms; sample_every: 4; history: 256 }");
        let binary=compile(&program).unwrap();
        assert_eq!(u16::from_le_bytes(binary[4..6].try_into().unwrap()),2);
        let start=u32::from_le_bytes(binary[20..24].try_into().unwrap()) as usize
            +u32::from_le_bytes(binary[152..156].try_into().unwrap()) as usize;
        assert_eq!(u32::from_le_bytes(binary[156..160].try_into().unwrap()),16);
        assert_eq!(f64::from_le_bytes(binary[start..start+8].try_into().unwrap()),2.5);
        assert_eq!(u32::from_le_bytes(binary[start+8..start+12].try_into().unwrap()),4);
        assert_eq!(u32::from_le_bytes(binary[start+12..start+16].try_into().unwrap()),256);
        assert_eq!(binary,compile(&program).unwrap());
        assert_eq!(compile_with_performance(&program,false).unwrap(),compile(EXAMPLE).unwrap());
        assert_eq!(u16::from_le_bytes(compile(EXAMPLE).unwrap()[4..6].try_into().unwrap()),1);
    }
    #[test]
    fn performance_settings_are_validated_with_dimensions() {
        for (fields,message) in [
            ("tick_budget: 3kg","expected s/ms/us"),
            ("tick_budget: -1ms","tick_budget"),
            ("tick_budget: 0ms","tick_budget"),
            ("tick_budget: 5ms; sample_every: 0","sample_every"),
            ("tick_budget: 5ms; history: 3","history"),
            ("tick_budget: 5ms; history: 25.5","integer"),
            ("tick_budget: 5ms; tick_budget: 6ms","duplicate field"),
            ("sample_every: 2","requires tick_budget"),
            ("tick_budget: 5ms; magic: 2","unknown performance field"),
        ] {
            let source=format!("world Error {{ performance {{ {fields} }} }}");
            assert!(compile(&source).unwrap_err().message.contains(message),
                "{fields}: {:?}",compile(&source));
        }
    }

}
