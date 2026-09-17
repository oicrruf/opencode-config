# Components and States

## Use what exists

The most common way AI degrades a codebase: it hand-rolls what
already exists. A bespoke `<div onClick>` "button" beside the
project's real `Button`. A from-scratch dropdown with no keyboard
support beside an installed primitive that has it. A 14-class
Tailwind string copy-pasted onto every card instead of the component
or token that's right there. Every one of these is the same failure
— generating new instead of using what's present — and the result is
inconsistent, inaccessible, and unmaintainable.

Before you build a control or style an element, look at what the
project already gives you.

## States

Every interactive component has at least four states to design:
default, hover, focus, disabled. Add loading, error, empty when the
component renders data or async work. Each state is a real design
decision, not a `:hover { opacity: 0.8 }` placeholder.

## Forms

- One column unless the form has obvious pairs.
- Labels above inputs (left-aligned). Placeholders are not labels.
- Show validation inline, below the field, only after the user has
  finished editing that field or attempted submit.
- Errors are specific: "Email already in use" beats "Invalid email".

## Empty states

Empty states are not "Nothing here yet." They are the first thing
the user sees after sign-up, and they are an opportunity to teach
the verb. Show what to do next, with a button, in the same hierarchy
the rest of the product uses.
