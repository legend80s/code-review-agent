const { default: pkg } = await import("../package.json", {
	with: { type: "json" },
});

console.log("pkg:", pkg);
// # modify package.json to include "scripts":
// # "typecheck": "tsgo --noEmit",
// # "test": "node --test",
// # "pub:patch": "npm version patch",
// # "pub:minor": "npm version minor",
// # "pub:major": "npm version major",
// # "preversion": "npm test && npm run typecheck",
// # "postversion": "npm publish && git push && git push --tags"
npm pkg set scripts.typecheck="tsgo --noEmit" scripts.test="node --test" scripts.preview="vite preview"
