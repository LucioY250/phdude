const chunk = 'x'.repeat(1024 * 1024);
for (let i = 0; i < 15; i += 1) process.stdout.write(chunk);
