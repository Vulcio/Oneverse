# What the API accepts is described once, as schemas in core

Every request is a zod schema in `@oneverse/core` (#118): the API validates with it, every client takes its types
from it, and the API's docs are generated from it. One description keeps the web apps, Pulse and the native apps to
come from drifting away from what the API takes; class-validator DTOs were removed for it.
