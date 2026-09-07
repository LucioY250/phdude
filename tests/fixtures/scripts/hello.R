args <- commandArgs(trailingOnly = TRUE)
cat("ok", if (length(args) > 0) args[1] else "", "\n")
