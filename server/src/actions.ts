import { match, P } from "ts-pattern";
import { getFTPClient } from "./ftp";
import { ApplicationState } from "./index";
import { RegexDebugResult, RegexMatch } from "@shared/types";
import Handlebars from "handlebars";

export async function listDir(
  path: string,
  applicationState: ApplicationState,
) {
  return await match(
    await getFTPClient(applicationState.config, applicationState.communication),
  )
    .with({ type: "Ok", data: P.select() }, async (client) => {
      try {
        return await client.listDir(path);
      } catch (err) {
        applicationState.communication.logError(
          `FTP Connection error: ${err}"`,
        );
        return undefined;
      } finally {
        client.free();
      }
    })
    .with({ type: "ConnectionError", message: P.select() }, async (err) => {
      applicationState.communication.logError(`FTP Connection error: ${err}"`);
      return undefined;
    })
    .exhaustive();
}

export async function checkDir(
  path: string,
  applicationState: ApplicationState,
) {
  return await match(
    await getFTPClient(applicationState.config, applicationState.communication),
  )
    .with({ type: "Ok", data: P.select() }, async (client) => {
      try {
        await client.cd(path);
        return true;
      } catch {
        return false;
      } finally {
        client.free();
      }
    })
    .with({ type: "ConnectionError", message: P.select() }, async (err) => {
      applicationState.communication.logError(`FTP Connection error: ${err}"`);

      return false;
    })
    .exhaustive();
}

export async function getRegexDebugInfo(
  originFolder: string,
  fileRegex: string,
  fileRenameTemplate: string,
  syncName: string,
  applicationState: ApplicationState,
): Promise<RegexDebugResult> {
  try {
    const fileList = await match(
      await getFTPClient(
        applicationState.config,
        applicationState.communication,
      ),
    )
      .with({ type: "Ok", data: P.select() }, async (client) => {
        try {
          await client.cd(originFolder);
          return await client.listDir(originFolder);
        } catch (err) {
          throw new Error(`Could not access folder "${originFolder}": ${err}`);
        } finally {
          client.free();
        }
      })
      .with({ type: "ConnectionError", message: P.select() }, async (err) => {
        throw new Error(`FTP Connection error: ${err}`);
      })
      .exhaustive();

    if (!fileList || fileList.length === 0) {
      return {
        testFileName: "",
        matches: null,
        renamedFileName: null,
        error: `No files found in folder "${originFolder}"`,
      };
    }

    // Get the first file name
    const testFileName = fileList[0].name;

    // Test the regex
    let matches: RegexMatch[] | null = null;
    let renamedFileName: string | null = null;

    if (!fileRegex) {
      return {
        testFileName,
        matches: null,
        renamedFileName: testFileName,
      };
    }

    try {
      const regex = new RegExp(fileRegex);
      const match = regex.exec(testFileName);

      if (match) {
        matches = [
          {
            match: match[0],
            index: match.index,
            length: match[0].length,
            groups: Array.from(match),
          },
        ];

        // Generate renamed file name using the template
        if (fileRenameTemplate) {
          const templateData: { [key: string]: string } = {
            $syncName: syncName,
          };
          for (let i = 0; i < match.length; i++) {
            templateData["$" + i] = match[i];
          }

          const renameTemplate = Handlebars.compile(fileRenameTemplate);
          renamedFileName = renameTemplate(templateData);
        } else {
          renamedFileName = testFileName;
        }
      }

      return {
        testFileName,
        matches,
        renamedFileName,
      };
    } catch (regexError) {
      return {
        testFileName,
        matches: null,
        renamedFileName: null,
        error: `Invalid regex: ${regexError instanceof Error ? regexError.message : String(regexError)}`,
      };
    }
  } catch (error) {
    return {
      testFileName: "",
      matches: null,
      renamedFileName: null,
      error: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
