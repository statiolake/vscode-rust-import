import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let rustfmtAvailable: boolean | null = null;

/**
 * Check if rustfmt is available in the system
 */
export async function isRustfmtAvailable(): Promise<boolean> {
  if (rustfmtAvailable !== null) {
    return rustfmtAvailable;
  }

  try {
    await execAsync('rustfmt --version');
    rustfmtAvailable = true;
    return true;
  } catch {
    rustfmtAvailable = false;
    return false;
  }
}

/**
 * Format use statements using rustfmt
 * @param useStatements The use statements to format (as a single string)
 * @returns Formatted use statements, or the original if rustfmt fails
 */
export async function formatWithRustfmt(
  useStatements: string,
): Promise<string> {
  return new Promise((resolve) => {
    try {
      const rustfmt = spawn('rustfmt', ['--emit', 'stdout']);

      let stdout = '';
      let stderr = '';

      rustfmt.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      rustfmt.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      rustfmt.on('close', (code) => {
        if (code === 0 && stdout) {
          resolve(stdout.trim());
        } else {
          // If rustfmt fails, return the original
          console.error('rustfmt formatting failed:', stderr);
          resolve(useStatements);
        }
      });

      rustfmt.on('error', (error) => {
        // If rustfmt is not found or other error
        console.error('rustfmt error:', error);
        resolve(useStatements);
      });

      // Write to stdin and close it
      rustfmt.stdin.write(useStatements);
      rustfmt.stdin.end();
    } catch (error) {
      console.error('rustfmt formatting failed:', error);
      resolve(useStatements);
    }
  });
}

/**
 * Format use statements with rustfmt if available
 * @param useStatements The use statements to format
 * @param enabled Whether to use rustfmt (from config)
 * @returns Formatted use statements
 */
export async function formatUseStatementsWithRustfmt(
  useStatements: string,
  enabled: boolean = true,
): Promise<string> {
  if (!enabled) {
    return useStatements;
  }

  const available = await isRustfmtAvailable();
  if (!available) {
    return useStatements;
  }

  return formatWithRustfmt(useStatements);
}
