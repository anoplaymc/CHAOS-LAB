# ChaosScript language

ChaosScript is a small language in the style of Lua, made for CHAOS LAB mods. Files end in `.chaos`. It runs in its own interpreter: scripts can reach the game only through the [API](CHAOSSCRIPT_API.md), and never JavaScript.

If you know Lua, read [Differences from Lua](#differences-from-lua) first.

## Values

| Type | Examples | Notes |
| --- | --- | --- |
| `nil` | `nil` | No value |
| boolean | `true`, `false` | Only `nil` and `false` count as false. `0` and `""` are true |
| number | `1`, `2.5`, `1e3`, `0xff8800` | One number type |
| string | `"text"`, `'text'`, `[[long text]]` | Escapes: `\n \t \r \\ \" \' \xHH` |
| table | `{1, 2, x = 3}` | Lists and maps in one type |
| function | `function(a) return a end` | Closures work as you would expect |

## Variables

```lua
local count = 1            -- visible in this block
local a, b = 1, 2
global shared_count = 0    -- visible in all of this mod's files
count = count + 1
shared_count = shared_count + count
```

Using a name that was never declared is an error, both reading and assigning. `mod validate` finds these before the script runs, and suggests the name you probably meant.

A `local` at the top of a file stays private to that file. Files in a mod share only `global`s and global functions.

## Operators

From lowest to highest precedence:

```text
or
and
<  >  <=  >=  ==  ~=  (or !=)
..                     joins strings and numbers
+  -
*  /  %
not  #  -              unary. # is length
^                      power
```

`==` never converts types, so `1 == "1"` is false. `and` and `or` return one of their operands, so `x or 5` gives a default. Compare numbers with numbers and strings with strings: anything else is an error.

## Control flow

```lua
local n = 3
if n > 2 then
  print("big")
elseif n == 2 then
  print("two")
else
  print("small")
end

while n > 0 do
  n = n - 1
end

repeat
  n = n + 1
until n >= 3

for i = 1, 10 do print(i) end
for i = 10, 1, -2 do print(i) end

local t = {10, 20, x = 1}
for i, v in ipairs(t) do print(i, v) end     -- 1, 2... stopping at the first nil
for k, v in pairs(t) do print(k, v) end      -- everything, in insertion order
for k in pairs(t) do print(k) end

for i = 1, 5 do
  if i == 2 then continue end
  if i == 4 then break end
  print(i)
end
```

A `for ... in` loop takes `pairs(t)`, `ipairs(t)` or a table, and walks a snapshot, so it's safe to change the table inside the loop. Custom iterator functions aren't supported.

## Functions

```lua
local function add(a, b)
  return a + b
end

function shout(text)                -- a mod-wide function
  return string.upper(text) .. "!"
end

local double = function(x) return x * 2 end
print(add(1, 2), shout("hey"), double(4))

local function counter()
  local n = 0
  return function()
    n = n + 1
    return n
  end
end
local next_number = counter()
next_number()
print(next_number())   -- 2
```

A `local function` is only visible below its declaration. To have two call each other, write `local later` first and assign it afterwards, or use mod-wide functions, which exist once their definition has run.

A function returns one value. To return several, return a table. Missing arguments are `nil`, and extra arguments are ignored. A call with a single table or string argument can drop the parentheses: `register.prop{ ... }`, `print "hi"`.

## Tables

```lua
local list = {"a", "b", "c"}       -- lists start at 1
print(list[1], #list)

local bot = {name = "Rex", ["hit points"] = 10}
print(bot.name, bot["hit points"])

bot.name = nil                      -- assigning nil removes a key
table.insert(list, "d")

function bot.describe(self, extra)  -- method: self is written out
  return tostring(self["hit points"]) .. extra
end
print(bot:describe("!"))            -- a:f(x) means a.f(a, x)
print(("hello"):upper())            -- string methods come from the string library
```

Keys can be strings, numbers, booleans, tables or functions, but not `nil`. `#t` counts the unbroken list from 1. `table.count(t)` counts every key. `pairs` order is insertion order, which is reliable.

## Errors

```lua
local result = pcall(function()
  error("something broke")
end)
if not result.ok then
  log.warn("caught:", result.error)
end

local good = pcall(math.floor, 1.5)
print(good.ok, good.value)

assert(1 + 1 == 2, "maths is broken")
```

An uncaught error stops the current callback and is logged with its file, line and call stack. The mod keeps running, unless it fails repeatedly (see below). `pcall` can't catch running out of budget or memory.

## Limits

These are enforced by the interpreter and the mod host.

| Limit | Value | What happens |
| --- | --- | --- |
| Loading all of a mod's top-level code | 5,000,000 operations per file | Load fails, and everything it registered is rolled back |
| One callback | 200,000 operations | The callback is stopped and an error logged |
| One mod in one physics step | About 1,000,000 operations | `tick` handlers skip that step |
| Call depth | 120 | Error |
| One table | 200,000 entries | Error |
| New table entries in one callback | 400,000 | Error |
| One string | 1,048,576 characters | Error |
| Data a mod keeps alive | About 1,000,000 cells, checked every 5 seconds | Mod stopped |
| One source file | 512 KB | Won't load |
| Limit errors before a mod is stopped | 3 | Mod stopped |
| Ordinary errors before a mod is stopped | 25 in 10 seconds | Mod stopped |

An operation is a statement, a call or a loop iteration. A stopped mod is reported as *Stopped after errors*. Its objects stay in the world without their scripts, and reloading it starts it again.

## Standard library

Basics, `math`, `string` and `table`: see [the API reference](CHAOSSCRIPT_API.md#standard-library). `math.random` gives each mod its own stream.

## Differences from Lua

Deliberate, to keep the language small and mistakes loud:

- Undeclared names are errors. Declare mod-wide variables with `global`.
- One return value. No `return a, b` and no `local a, b = f()`.
- No multiple assignment such as `a, b = 1, 2`. `local a, b = 1, 2` is fine.
- `!=` works as well as `~=`. `continue` exists.
- No `+=`, `&&`, `||`: the parser tells you what to write instead.
- No metatables, coroutines, varargs, `goto`, `require` or `load`.
- Strings have no patterns. `string.find`, `string.replace` and `string.split` use plain text.
- `function a:b()` isn't allowed. Write `function a.b(self)`. Calling `a:b()` is.
- `pcall` returns a table: `{ok=, value=, error=}`.
- `print` writes to the debug console.
