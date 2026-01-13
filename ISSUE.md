Create a tool that takes a yaml config file as input, see test example test-repos-input.yaml and then for each repo in the input file updates the target repo by creating a json file with the name of fileName in the config in the repo root or overwrites the existing one. The format can be seen here test-repo-output.json IE the json property of the input file as a single json file converted.

The tool should iterate over all repos and continue if one fails, it should output progress / logs as it processes.

Each iteration consists of the following:

1. clean workspace
2. determine if github or azure devops repo
3. use relevant cli to repo type IE gh cli or azure cli
4. clone repo
5. switch to new branch chore/sync-{sanitized filename of config}
6. generate json file and output as new file or overwrite
7. if git div shows now changes then continue to next repo
8. commit
9. push
10. create PR using PR template
11. if not last repo go back to 1 with next repo

You also need to update the PR.md template with some basic example and placeholders that you can replace and inject.

You can decide what language / scripting would be the most appropriate, we need to build this as quickly as possible and it should be very easy to use.

Also generate a readme.md on how to use this CLI app and what credentials needs to be provided for GH and Azure cli auth to work.
